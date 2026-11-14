import { describe, expect, it } from "vitest";
import type { LlmClient, LlmRequest, LlmResponse } from "../../../core/llm.ts";
import { extractStep } from "../../../core/pipeline/extract.ts";
import type { RunContext } from "../../../core/pipeline/run.ts";

const ctx: RunContext = {
  runId: "run-1", documentId: "doc-1",
  parsed: { kind: "pdf", pages: [1, 2, 3].map((page) => ({ page, text: `text of page ${page}`, source: "text_layer" as const, needsOcr: false })) },
};

const OUTPUTS: Record<string, unknown> = {
  "extract-fund": { commitment: { raw: "500.0", page: 1 }, paid_in: { raw: "330.5", page: 1 }, unfunded: { raw: "169.5", page: 1 },
    distributions: { raw: "60.0", page: 1 }, nav: { raw: "420.8", page: 1 }, tvpi: { raw: "1.45x", page: 1 }, dpi: { raw: "0.18x", page: 1 },
    rvpi: { raw: "1.27x", page: 1 }, net_irr: { raw: "7.1%", page: 1 } },
  "extract-portfolio": { companies: [{ name: "Morlin GmbH", country: "AT", sector: "Business Services", investment_date: null,
    invested: { raw: "35.4", page: 2 }, realized: { raw: "0.0", page: 2 }, unrealized: { raw: "86.8", page: 2 },
    total_value: { raw: "86.8", page: 2 }, gross_moic: { raw: "2.45x", page: 2 } }] },
  "extract-operating": { companies: [{ name: "Morlin GmbH", revenue_ltm: { raw: "100.8", page: 3 }, ebitda_ltm: { raw: "12.8", page: 3 }, net_debt: { raw: "-6.0", page: 3 } }] },
  "extract-qualitative": { key_updates: ["Morlin GmbH appointed a new CFO"], outlook: "We expect continued progress." },
};

function fakeLlm(cached = false): LlmClient & { requests: LlmRequest<unknown>[] } {
  return {
    requests: [],
    async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
      this.requests.push(req as LlmRequest<unknown>);
      return { output: req.schema.parse(OUTPUTS[req.prompt.id]), cacheKey: "k", cached,
        usage: { model: "claude-opus-5-5", inputTokens: 2_000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: cached ? 0 : 0.02 } };
    },
  };
}

describe("extractStep", () => {
  it("asks one versioned prompt per section, at medium effort, over every page", async () => {
    const llm = fakeLlm();

    await extractStep(llm).run(ctx);

    expect(llm.requests.map((r) => `${r.prompt.id}@${r.prompt.version}`).sort())
      .toEqual(["extract-fund@1", "extract-operating@1", "extract-portfolio@1", "extract-qualitative@1"]);
    for (const request of llm.requests) {
      expect(request.effort).toBe("medium");
      expect(request.text).toContain('<page number="3">');
      expect(request.system).toMatch(/exactly as printed/i);
    }
  });

  it("collects the raw sections into the run context, marked as read from text", async () => {
    const { ctx: out } = await extractStep(fakeLlm()).run(ctx);

    expect(out.raw?.fund.nav).toEqual({ raw: "420.8", page: 1 });
    expect(out.raw?.portfolio.companies).toHaveLength(1);
    expect(out.raw?.readMode).toBe("text");
  });

  it("sums the cost of the section calls and reports when all were cached", async () => {
    expect((await extractStep(fakeLlm()).run(ctx)).summary).toMatchObject({ costUsd: 0.08, cached: false, companies: 1 });
    expect((await extractStep(fakeLlm(true)).run(ctx)).summary).toMatchObject({ costUsd: 0, cached: true });
  });
});
