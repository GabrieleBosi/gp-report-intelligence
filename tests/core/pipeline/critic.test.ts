import { describe, expect, it } from "vitest";
import type { LlmClient, LlmRequest, LlmResponse } from "../../../core/llm.ts";
import type { Classification } from "../../../core/pipeline/classify.ts";
import { criticStep } from "../../../core/pipeline/critic.ts";
import { normalizeRaw, type ExtractionRow, type ExtractionStore } from "../../../core/pipeline/normalize-step.ts";
import type { RawExtraction } from "../../../core/pipeline/prompts/extract.ts";
import type { RunContext } from "../../../core/pipeline/run.ts";

const classification: Classification = {
  gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", report_type: "quarterly_report",
  currency: "EUR", unit_statement: "all amounts in EUR m", evidence_page: 1, gp_status: "known", known_fund_id: "f", missing: [],
};
const v = (raw: string | null, page: number | null = 1) => ({ raw, page });
const company = (name: string, unrealized: string) => ({
  name, country: "AT", sector: "Industrials", investment_date: null,
  invested: v("100.0", 2), realized: v("0.0", 2), unrealized: v(unrealized, 2), total_value: v(unrealized, 2), gross_moic: v(`${(Number(unrealized) / 100).toFixed(2)}x`, 2),
});

// Consistent by construction: paid-in 330.5, distributions 60.0, NAV 420.8 -> TVPI 1.45, DPI 0.18, RVPI 1.27;
// companies' unrealized 140.3 + 140.2 + 140.3 = 420.8.
function raw(fund: Partial<RawExtraction["fund"]> = {}, companies = [company("A GmbH", "140.3"), company("B AG", "140.2"), company("C Oy", "140.3")]): RawExtraction {
  return {
    readMode: "text",
    fund: { commitment: v("500.0"), paid_in: v("330.5"), unfunded: v("169.5"), distributions: v("60.0"), nav: v("420.8"),
      tvpi: v("1.45x"), dpi: v("0.18x"), rvpi: v("1.27x"), net_irr: v("7.1%"), ...fund },
    portfolio: { companies }, operating: { companies: [] }, qualitative: { key_updates: [], outlook: null },
  };
}

function ctxFor(r: RawExtraction): RunContext {
  const { extraction, checks, issues } = normalizeRaw(r, classification);
  return {
    runId: "run-1", documentId: "doc-1", classification, raw: r, extraction, checks, normalizationIssues: issues,
    parsed: { kind: "pdf", pages: [{ page: 1, text: "fund page", source: "text_layer", needsOcr: false }, { page: 2, text: "portfolio page", source: "text_layer", needsOcr: false }] },
  };
}

type Answer = (req: LlmRequest<unknown>, call: number) => unknown;
function fakeLlm(answer: Answer): LlmClient & { requests: LlmRequest<unknown>[] } {
  return {
    requests: [],
    async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
      this.requests.push(req as LlmRequest<unknown>);
      return { output: req.schema.parse(answer(req as LlmRequest<unknown>, this.requests.length)), cacheKey: "k",
        usage: { model: "claude-opus-5-5", inputTokens: 3_000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.03 } };
    },
  };
}
const verdicts = (items: { field: string; verdict: string; raw?: string | null; page?: number | null }[]) =>
  ({ fields: items.map((i) => ({ raw: null, page: null, evidence: null, ...i })) });

class MemoryExtractions implements ExtractionStore {
  rows: ExtractionRow[] = [];
  async append(row: ExtractionRow) { this.rows.push(row); }
}
const failedIds = (ctx: RunContext) => (ctx.checks ?? []).filter((c) => c.status === "fail").map((c) => c.id);

describe("criticStep", () => {
  it("does nothing when every check passed", async () => {
    const llm = fakeLlm(() => { throw new Error("must not be called"); });
    const store = new MemoryExtractions();

    const { summary } = await criticStep(llm, store).run(ctxFor(raw()));

    expect(llm.requests).toEqual([]);
    expect(store.rows).toEqual([]);
    expect(summary).toMatchObject({ rounds: 0 });
  });

  it("confirms a figure the document really prints, leaving the inconsistency flagged for review (trap 1)", async () => {
    const llm = fakeLlm((req) => verdicts(
      (JSON.parse(/<fields>\n([\s\S]*)\n<\/fields>/.exec(req.text)?.[1] ?? "[]") as { field: string }[])
        .map((f) => ({ field: f.field, verdict: "confirmed_as_printed" }))));
    const store = new MemoryExtractions();

    const { ctx, summary } = await criticStep(llm, store).run(ctxFor(raw({ tvpi: v("1.57x") })));

    expect(failedIds(ctx)).toEqual(["tvpi_inconsistent"]);
    expect(store.rows.map((r) => r.round)).toEqual([1]);
    expect(summary).toMatchObject({ rounds: 1, corrected: [], confirmed: expect.arrayContaining(["fund.tvpi"]), checksFailedAfter: ["tvpi_inconsistent"] });
  });

  it("applies a correction read from the source and stops once the checks pass", async () => {
    const llm = fakeLlm(() => verdicts([{ field: "fund.tvpi", verdict: "corrected", raw: "1.45x", page: 1 }]));
    const store = new MemoryExtractions();

    const { ctx, summary } = await criticStep(llm, store).run(ctxFor(raw({ tvpi: v("1.54x") })));

    expect(failedIds(ctx)).toEqual([]);
    expect(ctx.extraction?.fund.tvpi?.value).toBe(1.45);
    expect(ctx.raw?.fund.tvpi).toEqual({ raw: "1.45x", page: 1 });
    expect(store.rows.map((r) => r.round)).toEqual([1]);
    expect(summary).toMatchObject({ corrected: ["fund.tvpi"], checksFailedAfter: [] });
  });

  it("re-reads the whole portfolio when the NAV bridge fails, because missing companies have no fields to re-read", async () => {
    const llm = fakeLlm((req) => req.prompt.id === "critic-portfolio"
      ? { companies: [company("A GmbH", "140.3"), company("B AG", "140.2"), company("C Oy", "140.3")] }
      : verdicts([]));
    const store = new MemoryExtractions();

    const { ctx, summary } = await criticStep(llm, store).run(ctxFor(raw({}, [company("A GmbH", "140.3")])));

    expect(llm.requests[0]?.prompt.id).toBe("critic-portfolio");
    expect(llm.requests[0]?.text).toMatch(/sum to 140\.3.*net asset value.*420\.8/s);
    expect(ctx.extraction?.portfolio_companies).toHaveLength(3);
    expect(failedIds(ctx)).toEqual([]);
    expect(summary).toMatchObject({ portfolioReread: true, companiesBefore: 1, companiesAfter: 3 });
  });

  it("re-reads and corrects a company figure named by a failed company check", async () => {
    // B AG's total value misread as 150.2 (realized 0 + unrealized 140.2 = 140.2): company identities fail.
    const misread = { ...company("B AG", "140.2"), total_value: v("150.2", 2) };
    const llm = fakeLlm(() => verdicts([{ field: "portfolio_companies[1].total_value", verdict: "corrected", raw: "140.2", page: 2 }]));

    const { ctx, summary } = await criticStep(llm, new MemoryExtractions()).run(
      ctxFor(raw({}, [company("A GmbH", "140.3"), misread, company("C Oy", "140.3")])));

    expect(ctx.extraction?.portfolio_companies[1]?.total_value?.value).toBe(140_200_000);
    expect(failedIds(ctx)).toEqual([]);
    expect(summary).toMatchObject({ corrected: ["portfolio_companies[1].total_value"] });
  });

  it("re-reads an operating metric named by a failed check and corrects it from the source", async () => {
    const r = raw();
    r.operating.companies = [{ name: "B AG", revenue_ltm: v("300.0", 3), ebitda_ltm: v("724", 3), net_debt: v("10.0", 3) }];
    const llm = fakeLlm(() => verdicts([
      { field: "portfolio_companies[1].ebitda_ltm", verdict: "corrected", raw: "72.4", page: 3 },
      { field: "portfolio_companies[1].revenue_ltm", verdict: "confirmed_as_printed" },
    ]));

    const { ctx } = await criticStep(llm, new MemoryExtractions()).run(ctxFor(r));

    expect(llm.requests[0]?.text).toContain("B AG: ebitda ltm");
    expect(ctx.extraction?.portfolio_companies[1]?.ebitda_ltm?.value).toBe(72_400_000);
    expect(failedIds(ctx)).toEqual([]);
  });

  it("drops blank rows from a portfolio re-read too, so its output and the checks index the same companies", async () => {
    const blankRow = { name: "", country: null, sector: null, investment_date: null,
      invested: v(null, null), realized: v(null, null), unrealized: v(null, null), total_value: v(null, null), gross_moic: v(null, null) };
    const llm = fakeLlm((req) => req.prompt.id === "critic-portfolio"
      ? { companies: [blankRow, company("A GmbH", "140.3"), company("B AG", "140.2"), company("C Oy", "140.3")] }
      : verdicts([]));

    const { ctx } = await criticStep(llm, new MemoryExtractions()).run(ctxFor(raw({}, [company("A GmbH", "140.3")])));

    expect(ctx.raw?.portfolio.companies.map((c) => c.name)).toEqual(["A GmbH", "B AG", "C Oy"]);
    expect(ctx.extraction?.portfolio_companies.map((c) => c.name)).toEqual(["A GmbH", "B AG", "C Oy"]);
    expect(failedIds(ctx)).toEqual([]);
  });

  it("never runs more than two rounds", async () => {
    let tvpi = 1.6;
    const llm = fakeLlm(() => verdicts([{ field: "fund.tvpi", verdict: "corrected", raw: `${(tvpi += 0.1).toFixed(2)}x`, page: 1 }]));
    const store = new MemoryExtractions();

    const { summary } = await criticStep(llm, store).run(ctxFor(raw({ tvpi: v("1.60x") })));

    expect(store.rows.map((r) => r.round)).toEqual([1, 2]);
    expect(summary).toMatchObject({ rounds: 2, checksFailedAfter: ["tvpi_inconsistent"] });
  });

  it("ignores a correction that has no page reference, so every value stays traceable", async () => {
    const llm = fakeLlm(() => verdicts([{ field: "fund.tvpi", verdict: "corrected", raw: "1.45x", page: null }]));

    const { ctx, summary } = await criticStep(llm, new MemoryExtractions()).run(ctxFor(raw({ tvpi: v("1.54x") })));

    expect(ctx.raw?.fund.tvpi).toEqual({ raw: "1.54x", page: 1 });
    expect(summary).toMatchObject({ corrected: [], rejected: ["fund.tvpi"] });
  });

  it("asks only about the fields involved in failed checks, with the failed check messages", async () => {
    const llm = fakeLlm(() => verdicts([]));

    await criticStep(llm, new MemoryExtractions()).run(ctxFor(raw({ tvpi: v("1.57x") })));

    const asked = (JSON.parse(/<fields>\n([\s\S]*)\n<\/fields>/.exec(llm.requests[0]?.text ?? "")?.[1] ?? "[]") as { field: string }[]).map((f) => f.field);
    expect(asked.sort()).toEqual(["fund.distributions", "fund.nav", "fund.paid_in", "fund.tvpi"]);
    expect(llm.requests[0]).toMatchObject({ prompt: { id: "critic-fields", version: 1 }, effort: "high" });
    expect(llm.requests[0]?.text).toContain("TVPI printed 1.57");
  });
});
