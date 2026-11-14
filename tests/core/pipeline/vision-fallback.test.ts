import { describe, expect, it } from "vitest";
import type { LlmClient, LlmRequest, LlmResponse } from "../../../core/llm.ts";
import { extractStep, type PageRasterizer } from "../../../core/pipeline/extract.ts";
import type { RunContext } from "../../../core/pipeline/run.ts";

const v = (raw: string | null, page: number | null = 1) => ({ raw, page });
const FUND = { commitment: v("500.0"), paid_in: v("323.9"), unfunded: v("176.1"), distributions: v("34.4"), nav: v(null, null),
  tvpi: v("1.44x"), dpi: v("0.11x"), rvpi: v("1.33x"), net_irr: v("7.9%") };
const COMPANY = { name: "Morlin GmbH", country: "AT", sector: "Industrials", investment_date: null,
  invested: v("35.4", 2), realized: v("0.0", 2), unrealized: v("86.8", 2), total_value: v("86.8", 2), gross_moic: v("2.45x", 2) };

function fakeLlm(fund: Record<string, unknown>, visionFund: Record<string, unknown> = { ...FUND, nav: v("431.1", 1) },
  portfolio: unknown[] = [COMPANY], visionPortfolio: unknown[] = [COMPANY]) {
  const llm: LlmClient & { requests: LlmRequest<unknown>[] } = {
    requests: [],
    async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
      this.requests.push(req as LlmRequest<unknown>);
      const outputs: Record<string, unknown> = {
        "extract-fund": fund, "extract-fund-vision": visionFund,
        "extract-portfolio": { companies: portfolio }, "extract-portfolio-vision": { companies: visionPortfolio },
        "extract-operating": { companies: [] },
        "extract-qualitative": { key_updates: [], outlook: null },
      };
      return { output: req.schema.parse(outputs[req.prompt.id]), cacheKey: "k",
        usage: { model: "claude-opus-5-5", inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01 } };
    },
  };
  return llm;
}

function fakeRasterizer(): PageRasterizer & { pages: number[] } {
  return { pages: [], version: "pdfjs@test", async renderPage(_pdf, page) { this.pages.push(page); return Buffer.from(`png-page-${page}`); } };
}

const ctx: RunContext = {
  runId: "run-1", documentId: "doc-1",
  loaded: { bytes: new Uint8Array([1, 2, 3]), document: { id: "doc-1", sha256: "f".repeat(64), filename: "r.pdf", mime: "application/pdf",
    size_bytes: 3, storage_path: "x", source: "upload", corpus_meta: null, created_at: "t" } },
  parsed: { kind: "pdf", pages: [1, 2, 3].map((page) => ({ page, text: `page ${page}`, source: "text_layer" as const, needsOcr: false })) },
};

describe("vision fallback in step 4", () => {
  it("does not render anything when the text read found every key figure", async () => {
    const rasterizer = fakeRasterizer();
    const llm = fakeLlm({ ...FUND, nav: v("431.1") });

    const { ctx: out } = await extractStep(llm, rasterizer).run(ctx);

    expect(rasterizer.pages).toEqual([]);
    expect(llm.requests.map((r) => r.prompt.id)).not.toContain("extract-fund-vision");
    expect(out.raw?.visionFields).toEqual([]);
  });

  it("re-asks the fund section from the image of the page its other figures came from, and fills only the missing NAV", async () => {
    const rasterizer = fakeRasterizer();
    const llm = fakeLlm(FUND, { ...FUND, nav: v("431.1", 1), commitment: v("999.9", 1) });

    const { ctx: out, summary } = await extractStep(llm, rasterizer).run(ctx);

    const vision = llm.requests.find((r) => r.prompt.id === "extract-fund-vision");
    expect(rasterizer.pages).toEqual([1]);
    expect(vision?.images).toHaveLength(1);
    expect(vision?.images?.[0]?.id).toBe(`${"f".repeat(64)}#p1@130/pdfjs@test`);
    expect(out.raw?.fund.nav).toEqual({ raw: "431.1", page: 1 });
    expect(out.raw?.fund.commitment).toEqual({ raw: "500.0", page: 1 }); // a text read is never overridden
    expect(out.raw?.visionFields).toEqual(["fund.nav"]);
    expect(summary).toMatchObject({ visionFallback: { sections: ["fund"], pages: [1], filled: ["fund.nav"] } });
  });

  it("leaves the figure missing when the images do not show it either", async () => {
    const llm = fakeLlm(FUND, FUND);

    const { ctx: out } = await extractStep(llm, fakeRasterizer()).run(ctx);

    expect(out.raw?.fund.nav).toEqual({ raw: null, page: null });
    expect(out.raw?.visionFields).toEqual([]);
  });

  it("skips the fallback when no page renderer is available", async () => {
    const llm = fakeLlm(FUND);

    const { ctx: out } = await extractStep(llm).run(ctx);

    expect(llm.requests.map((r) => r.prompt.id)).not.toContain("extract-fund-vision");
    expect(out.raw?.fund.nav).toEqual({ raw: null, page: null });
  });

  it("re-asks the portfolio from its page image when a company's total value is missing, matching companies by name", async () => {
    const rasterizer = fakeRasterizer();
    const missingTotal = { ...COMPANY, total_value: v(null, null) };
    const llm = fakeLlm({ ...FUND, nav: v("431.1") }, FUND, [missingTotal], [{ ...COMPANY, name: "MORLIN GMBH" }]);

    const { ctx: out, summary } = await extractStep(llm, rasterizer).run(ctx);

    expect(rasterizer.pages).toEqual([2]);
    expect(out.raw?.portfolio.companies[0]?.total_value).toEqual({ raw: "86.8", page: 2 });
    expect(summary).toMatchObject({ visionFallback: { sections: ["portfolio"], pages: [2], filled: ["portfolio_companies[0].total_value"] } });
  });

  it("looks at the first pages when the section gives no clue where it is printed", async () => {
    const rasterizer = fakeRasterizer();
    const nothing = Object.fromEntries(Object.keys(FUND).map((k) => [k, v(null, null)]));

    await extractStep(fakeLlm(nothing, nothing), rasterizer).run(ctx);

    expect(rasterizer.pages).toEqual([1, 2, 3]);
  });
});
