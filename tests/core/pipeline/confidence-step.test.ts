import { describe, expect, it } from "vitest";
import type { LlmClient, LlmRequest, LlmResponse } from "../../../core/llm.ts";
import type { Classification } from "../../../core/pipeline/classify.ts";
import { confidenceStep, type AssessmentRow, type AssessmentStore } from "../../../core/pipeline/confidence-step.ts";
import type { PageRasterizer } from "../../../core/pipeline/extract.ts";
import { normalizeRaw } from "../../../core/pipeline/normalize-step.ts";
import type { RawExtraction } from "../../../core/pipeline/prompts/extract.ts";
import type { RunContext } from "../../../core/pipeline/run.ts";
import { SPREADSHEET_MIME } from "../../../core/documents.ts";

const classification: Classification = {
  gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", report_type: "quarterly_report",
  currency: "EUR", unit_statement: "all amounts in EUR m", evidence_page: 1, gp_status: "known", known_fund_id: "f", missing: [],
};
const v = (raw: string | null, page: number | null = 1) => ({ raw, page });
const company = (name: string, value: string) => ({
  name, country: "AT", sector: "Industrials", investment_date: null,
  invested: v("100.0", 2), realized: v("0.0", 2), unrealized: v(value, 2), total_value: v(value, 2), gross_moic: v(`${(Number(value) / 100).toFixed(2)}x`, 2),
});
function rawA(fund: Partial<RawExtraction["fund"]> = {}): RawExtraction {
  return {
    readMode: "text", visionFields: [],
    fund: { commitment: v("500.0"), paid_in: v("330.5"), unfunded: v("169.5"), distributions: v("60.0"), nav: v("420.8"),
      tvpi: v("1.45x"), dpi: v("0.18x"), rvpi: v("1.27x"), net_irr: v("7.1%"), ...fund },
    portfolio: { companies: [company("A GmbH", "140.3"), company("B AG", "140.2"), company("C Oy", "140.3")] },
    operating: { companies: [] }, qualitative: { key_updates: [], outlook: null },
  };
}
const READ_B = {
  fund: { commitment: v("500.0"), paid_in: v("330.5"), distributions: v("60.0"), nav: v("420.8"), tvpi: v("1.45x"), dpi: v("0.18x") },
  companies: [{ name: "A GmbH", total_value: v("140.3", 2) }, { name: "B AG", total_value: v("140.2", 2) }, { name: "C Oy", total_value: v("140.3", 2) }],
};

function ctxFor(raw: RawExtraction, c: Classification = classification, extractionRound = 0): RunContext {
  const { extraction, checks, issues } = normalizeRaw(raw, c);
  return {
    runId: "run-1", documentId: "doc-1", classification: c, raw, extraction, checks, normalizationIssues: issues, extractionRound,
    loaded: { bytes: new Uint8Array([1]), document: { id: "doc-1", sha256: "e".repeat(64), filename: "r.pdf", mime: "application/pdf",
      size_bytes: 1, storage_path: "s", source: "corpus", corpus_meta: null, created_at: "t" } },
    parsed: { kind: "pdf", pages: [1, 2, 3].map((page) => ({ page, text: `page ${page}`, source: "text_layer" as const, needsOcr: false })) },
  };
}

function fakeLlm(output: unknown = READ_B): LlmClient & { requests: LlmRequest<unknown>[] } {
  return {
    requests: [],
    async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
      this.requests.push(req as LlmRequest<unknown>);
      return { output: req.schema.parse(output), cacheKey: "k",
        usage: { model: "claude-opus-5-5", inputTokens: 2_500, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.016 } };
    },
  };
}
const rasterizer: PageRasterizer & { pages: number[] } = {
  pages: [], version: "pdfjs@test", async renderPage(_pdf, page) { this.pages.push(page); return Buffer.from(`png-${page}`); },
};
class MemoryAssessments implements AssessmentStore {
  rows: AssessmentRow[] = [];
  async append(row: AssessmentRow) { this.rows.push(row); }
}

describe("confidenceStep", () => {
  it("keeps read B blind: its request carries page images but none of read A's values", async () => {
    rasterizer.pages = [];
    const llm = fakeLlm();

    await confidenceStep(llm, rasterizer, new MemoryAssessments()).run(ctxFor(rawA()));

    const request = llm.requests[0];
    expect(request).toMatchObject({ prompt: { id: "read-b", version: 1 }, step: "confidence" });
    for (const printed of ["500.0", "330.5", "60.0", "420.8", "1.45x", "0.18x", "140.3", "EUR m"]) {
      expect(`${request?.system}\n${request?.text}`, printed).not.toContain(printed);
    }
    expect(rasterizer.pages).toEqual([1, 2]);
    expect(request?.images?.map((i) => i.id)).toEqual([`${"e".repeat(64)}#p1@130/pdfjs@test`, `${"e".repeat(64)}#p2@130/pdfjs@test`]);
  });

  it("routes a clean, agreeing document to posting and stores the assessment with its policy and round", async () => {
    const store = new MemoryAssessments();

    const { ctx, summary } = await confidenceStep(fakeLlm(), rasterizer, store).run(ctxFor(rawA(), classification, 1));

    expect(ctx.finalStatus).toBe("ready_to_post");
    expect(summary).toMatchObject({ route: "auto_post", level: "high", policy: "policy@3", costUsd: 0.016 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ run_id: "run-1", round: 1, route: "auto_post", level: "high", policy: "policy@3" });
    expect(store.rows[0]?.fields.length).toBe(9); // 6 fund key figures + 3 company totals
  });

  it("sends a source inconsistency to review with the reason", async () => {
    const llm = fakeLlm({ ...READ_B, fund: { ...READ_B.fund, tvpi: v("1.57x") } });

    const { ctx, summary } = await confidenceStep(llm, rasterizer, new MemoryAssessments()).run(ctxFor(rawA({ tvpi: v("1.57x") })));

    expect(ctx.finalStatus).toBe("needs_review");
    expect(String(summary?.reasons)).toMatch(/report itself may be inconsistent/);
  });

  it("routes an uploaded document to review even when every figure is high (policy@2)", async () => {
    const ctx = ctxFor(rawA());
    if (!ctx.loaded) throw new Error("fixture has no loaded document");
    const upload = { ...ctx, loaded: { ...ctx.loaded, document: { ...ctx.loaded.document, source: "upload" as const } } };

    const { ctx: out, summary } = await confidenceStep(fakeLlm(), rasterizer, new MemoryAssessments()).run(upload);

    expect(summary).toMatchObject({ route: "review", level: "high" });
    expect(out.finalStatus).toBe("needs_review");
  });

  it("triages an unknown GP without paying for a second read", async () => {
    const llm = fakeLlm();

    const { ctx, summary } = await confidenceStep(llm, rasterizer, new MemoryAssessments())
      .run(ctxFor(rawA(), { ...classification, gp_status: "unknown", known_fund_id: null }));

    expect(llm.requests).toEqual([]);
    expect(ctx.finalStatus).toBe("needs_triage");
    expect(summary).toMatchObject({ route: "triage", costUsd: 0 });
  });

  it("for a workbook, read B is the cell lookup: no LLM call, no cost, and agreement can route to posting", async () => {
    const llm = fakeLlm();
    const ctx = ctxFor(rawA());
    const sheet = ["A1: Total commitments | B1: 500.0", "A2: Paid-in capital | B2: 330.5", "A3: Cumulative distributions | B3: 60.0",
      "A4: Net asset value | B4: 420.8", "A5: TVPI | B5: 1.45x", "A6: DPI | B6: 0.18x",
      "A8: Company | B8: Total value", "A9: A GmbH | B9: 140.3", "A10: B AG | B10: 140.2", "A11: C Oy | B11: 140.3"].join("\n");
    if (!ctx.loaded) throw new Error("fixture has no loaded document");
    const workbook = { ...ctx, loaded: { ...ctx.loaded, document: { ...ctx.loaded.document, mime: SPREADSHEET_MIME } },
      parsed: { kind: "xlsx" as const, pages: [{ page: 1, text: `Sheet 1 "Fund"\n${sheet}`, source: "sheet" as const, needsOcr: false }] } };
    // read A cites company totals on page 2 in this fixture; the lookup reads them on sheet 1 - pages are not compared.

    const { ctx: out, summary, actor } = await confidenceStep(llm, rasterizer, new MemoryAssessments()).run(workbook);

    expect(llm.requests).toEqual([]);
    expect(actor).toBe("system");
    expect(summary).toMatchObject({ route: "auto_post", costUsd: 0, readB: "cell lookup" });
    expect(out.finalStatus).toBe("ready_to_post");
  });

  it("renders the first pages of a triage run for the review screen (no LLM call), and a render failure never fails the run", async () => {
    const unknown = { ...classification, gp_status: "unknown" as const, known_fund_id: null };
    rasterizer.pages = [];

    await confidenceStep(fakeLlm(), rasterizer, new MemoryAssessments()).run(ctxFor(rawA(), unknown));
    expect(rasterizer.pages).toEqual([1, 2, 3]);

    const broken = { version: "v", async renderPage(): Promise<Buffer> { throw new Error("canvas unavailable"); } };
    const { ctx } = await confidenceStep(fakeLlm(), broken, new MemoryAssessments()).run(ctxFor(rawA(), unknown));
    expect(ctx.finalStatus).toBe("needs_triage");
  });

  it("without a page renderer there is no read B, so the document goes to review", async () => {
    const llm = fakeLlm();

    const { ctx } = await confidenceStep(llm, undefined, new MemoryAssessments()).run(ctxFor(rawA()));

    expect(llm.requests).toEqual([]);
    expect(ctx.finalStatus).toBe("needs_review");
  });
});
