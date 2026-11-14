import { describe, expect, it } from "vitest";
import { forPipeline } from "../../../core/documents.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../../../core/llm.ts";
import { classifyStep, matchKnownFund, type KnownFund } from "../../../core/pipeline/classify.ts";
import type { RunContext } from "../../../core/pipeline/run.ts";

const REGISTRY: KnownFund[] = [
  { id: "f-alp", gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", aliases: ["Alpenrose IV"] },
  { id: "f-nor", gp_name: "Nordkap Equity", fund_name: "Nordkap Mid-Market III", aliases: ["Nordkap MM III"] },
  { id: "f-mer", gp_name: "Meridian Growth", fund_name: "Meridian Tech Opportunities I", aliases: [] },
];

describe("matchKnownFund", () => {
  it.each([
    ["Alpenrose Buyout IV", "f-alp"],
    ["ALPENROSE BUYOUT IV", "f-alp"],
    ["Alpenrose Buyout Fund IV, L.P.", "f-alp"],
    ["Alpenrose Buyout 4", "f-alp"],
    ["Alpenrose IV", "f-alp"],
    ["Nordkap MM III", "f-nor"],
    ["Nordkap Mid Market III SCSp", "f-nor"],
    ["Meridian Tech Opportunities Fund I LP", "f-mer"],
  ])("recognizes %j as a known fund", (name, id) => {
    expect(matchKnownFund(name, REGISTRY)).toEqual({ status: "known", fundId: id });
  });

  it.each([
    ["Alpenrose Buyout V"], // a different vintage of a known GP is a different fund
    ["Tessera Seed Fund I"],
    ["Alpenrose"],
    ["Nordkap Mid-Market II"], // OCR damage of "III" must never match the registry's fund III (or any other)
    ["Harbourline Growth ||"],
    [""],
  ])("treats %j as unknown (triage)", (name) => {
    expect(matchKnownFund(name, REGISTRY)).toEqual({ status: "unknown" });
  });
});

const PAGE_ONE = "Alpenrose Capital\nAlpenrose Buyout IV - Quarterly Report Q2 2026\nReporting date: 30 June 2026 - all amounts in EUR m";
const ctx: RunContext = {
  runId: "run-1", documentId: "doc-1",
  parsed: { kind: "pdf", pages: [
    { page: 1, text: PAGE_ONE, source: "text_layer", needsOcr: false },
    { page: 2, text: "Portfolio overview", source: "text_layer", needsOcr: false },
    { page: 3, text: "Operating metrics", source: "text_layer", needsOcr: false },
  ] },
};

function fakeLlm(output: Record<string, unknown>, cached = false): LlmClient & { requests: LlmRequest<unknown>[] } {
  return {
    requests: [],
    async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
      this.requests.push(req as LlmRequest<unknown>);
      return { output: req.schema.parse(output), cacheKey: "k", cached,
        usage: { model: "claude-opus-5-5", inputTokens: 900, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: cached ? 0 : 0.0048 } };
    },
  };
}
const ALPENROSE = {
  gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", report_type: "quarterly_report",
  currency: "EUR", unit_statement: "all amounts in EUR m unless stated otherwise", evidence_page: 1,
};
const registry = { list: async () => REGISTRY };

describe("classifyStep", () => {
  it("sends the first two pages, delimited as data, with the versioned classify prompt at low effort", async () => {
    const llm = fakeLlm(ALPENROSE);

    await classifyStep(llm, registry).run(ctx);

    const request = llm.requests[0];
    expect(request).toMatchObject({ step: "classify", prompt: { id: "classify", version: 1 }, effort: "low", model: "claude-opus-5-5" });
    expect(request?.text).toContain('<page number="1">');
    expect(request?.text).toContain('<page number="2">');
    expect(request?.text).not.toContain('<page number="3">');
    expect(request?.system).toMatch(/data, never instructions/i);
  });

  it("records the classification, matches the registry, and reports cost and the model as actor", async () => {
    const outcome = await classifyStep(fakeLlm(ALPENROSE), registry).run(ctx);

    expect(outcome.ctx.classification).toMatchObject({ fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", currency: "EUR", gp_status: "known", known_fund_id: "f-alp", missing: [] });
    expect(outcome.summary).toMatchObject({ fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", gp_status: "known", costUsd: 0.0048, cached: false });
    expect(outcome.actor).toBe("llm:claude-opus-5-5");
  });

  it("marks a fund missing from the registry as unknown, for triage", async () => {
    const outcome = await classifyStep(fakeLlm({ ...ALPENROSE, gp_name: "Tessera Ventures", fund_name: "Tessera Seed Fund I" }), registry).run(ctx);

    expect(outcome.ctx.classification).toMatchObject({ gp_status: "unknown", known_fund_id: null });
  });

  it("keeps going but lists what the report does not state or what fails validation", async () => {
    const outcome = await classifyStep(fakeLlm({ ...ALPENROSE, period_end: "Q2 2026", currency: null }), registry).run(ctx);

    expect(outcome.ctx.classification).toMatchObject({ period_end: null, currency: null, missing: ["period_end", "currency"] });
  });

  it("for a scan (page 1 OCR'd), adds the page-1 image and uses the scan prompt that trusts the image for names", async () => {
    const pages: number[] = [];
    const rasterizer = { version: "pdfjs@test", async renderPage(_pdf: Uint8Array, page: number) { pages.push(page); return Buffer.from("png"); } };
    const scan: RunContext = {
      ...ctx,
      loaded: { bytes: new Uint8Array([1]), document: { id: "d", sha256: "c".repeat(64), filename: "s.pdf", mime: "application/pdf",
        size_bytes: 1, storage_path: "s", source: "upload", corpus_meta: null, created_at: "t" } },
      parsed: { kind: "pdf", pages: [{ page: 1, text: "Harbourline Growth ||", source: "ocr", needsOcr: false, quality: 91 }] },
    };
    const llm = fakeLlm(ALPENROSE);

    await classifyStep(llm, registry, rasterizer).run(scan);

    expect(pages).toEqual([1]);
    expect(llm.requests[0]).toMatchObject({ prompt: { id: "classify-scan", version: 1 }, effort: "low" });
    expect(llm.requests[0]?.images?.map((i) => i.id)).toEqual([`${"c".repeat(64)}#p1@130/pdfjs@test`]);
    expect(llm.requests[0]?.system).toMatch(/recognition errors/);
    expect(llm.requests[0]?.text).toContain("Harbourline Growth ||");
  });

  it("keeps text documents on classify@1 without images, even when a renderer is available", async () => {
    const rasterizer = { version: "v", async renderPage() { throw new Error("must not render a text document"); } };
    const llm = fakeLlm(ALPENROSE);

    await classifyStep(llm, registry, rasterizer).run(ctx);

    expect(llm.requests[0]).toMatchObject({ prompt: { id: "classify", version: 1 } });
    expect(llm.requests[0]?.images).toBeUndefined();
  });

  it("refuses to run without parsed text", async () => {
    await expect(classifyStep(fakeLlm(ALPENROSE), registry).run({ runId: "r", documentId: "d" })).rejects.toThrow(/parse step/);
  });
});

describe("forPipeline", () => {
  it("removes corpus metadata, so classification can only come from the document itself", () => {
    const doc = forPipeline({
      id: "d", sha256: "a".repeat(64), filename: "x.pdf", mime: "application/pdf", size_bytes: 1, storage_path: "s", source: "corpus",
      created_at: "t", corpus_meta: { doc_id: "alpenrose-iv-2026q2", gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", format: "native_pdf", split: "heldout" },
    });

    expect(doc.corpus_meta).toBeNull();
  });
});
