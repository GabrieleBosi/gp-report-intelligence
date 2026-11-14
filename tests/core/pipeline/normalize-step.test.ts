import { describe, expect, it } from "vitest";
import type { Classification } from "../../../core/pipeline/classify.ts";
import { normalizeStep, type ExtractionRow, type ExtractionStore } from "../../../core/pipeline/normalize-step.ts";
import type { RawExtraction } from "../../../core/pipeline/prompts/extract.ts";
import type { RunContext } from "../../../core/pipeline/run.ts";

const classification: Classification = {
  gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", report_type: "quarterly_report",
  currency: "EUR", unit_statement: "all amounts in EUR m unless stated otherwise", evidence_page: 1,
  gp_status: "known", known_fund_id: "f-alp", missing: [],
};
const v = (raw: string | null, page: number | null = 1) => ({ raw, page });

function raw(overrides: Partial<RawExtraction["fund"]> = {}): RawExtraction {
  return {
    readMode: "text",
    fund: { commitment: v("500.0"), paid_in: v("330.5"), unfunded: v("169.5"), distributions: v("60.0"), nav: v("420.8"),
      tvpi: v("1.45x"), dpi: v("0.18x"), rvpi: v("1.27x"), net_irr: v("7.1%"), ...overrides },
    portfolio: { companies: [
      { name: "Morlin GmbH", country: "AT", sector: "Business Services", investment_date: null,
        invested: v("35.4", 2), realized: v("0.0", 2), unrealized: v("86.8", 2), total_value: v("86.8", 2), gross_moic: v("2.45x", 2) },
    ] },
    operating: { companies: [{ name: "Morlin GmbH", revenue_ltm: v("100.8", 3), ebitda_ltm: v("12.8", 3), net_debt: v("-6.0", 3) }] },
    qualitative: { key_updates: ["Morlin GmbH appointed a new CFO"], outlook: null },
  };
}

class MemoryExtractions implements ExtractionStore {
  rows: ExtractionRow[] = [];
  async append(row: ExtractionRow) { this.rows.push(row); }
}

const run = async (overrides: Partial<RunContext> = {}) => {
  const store = new MemoryExtractions();
  const outcome = await normalizeStep(store).run({ runId: "run-1", documentId: "doc-1", classification, raw: raw(), ...overrides });
  return { ...outcome, store };
};

describe("normalizeStep", () => {
  it("turns printed strings into schema v1 values with currency and page sources", async () => {
    const { ctx } = await run();

    expect(ctx.extraction?.fund.nav).toEqual({ value: 420_800_000, currency: "EUR", source: { page: 1 } });
    expect(ctx.extraction?.fund.tvpi).toEqual({ value: 1.45, source: { page: 1 } });
    expect(ctx.extraction?.fund.net_irr).toEqual({ value: 0.071, source: { page: 1 } });
  });

  it("joins operating metrics to portfolio companies by name, keeping signs", async () => {
    const { ctx } = await run();

    expect(ctx.extraction?.portfolio_companies[0]).toMatchObject({
      name: "Morlin GmbH", total_value: { value: 86_800_000 }, net_debt: { value: -6_000_000, source: { page: 3 } },
    });
  });

  const blank = { name: "", country: null, sector: null, investment_date: null,
    invested: v(null, null), realized: v(null, null), unrealized: v(null, null), total_value: v(null, null), gross_moic: v(null, null) };

  it("drops a blank placeholder row (no name, no figures) and fails the NAV bridge, so the critic re-reads the portfolio", async () => {
    const placeholder = { ...raw(), portfolio: { companies: [blank] }, operating: { companies: [] } };

    const { ctx } = await run({ raw: placeholder });

    expect(ctx.extraction?.portfolio_companies).toEqual([]);
    expect(ctx.normalizationIssues).toContainEqual({ field: "portfolio_companies", raw: null, reason: "1 blank row ignored (no name, no figures)" });
    expect(ctx.checks?.find((c) => c.id === "nav_bridge_gap")?.status).toBe("fail");
  });

  it("hands on the filtered raw, so every later step indexes the same companies as the extraction and its checks", async () => {
    const withLeadingBlank = { ...raw(), portfolio: { companies: [blank, ...raw().portfolio.companies] } };

    const { ctx, store } = await run({ raw: withLeadingBlank });

    expect(ctx.raw?.portfolio.companies.map((c) => c.name)).toEqual(["Morlin GmbH"]);
    expect(ctx.extraction?.portfolio_companies.map((c) => c.name)).toEqual(["Morlin GmbH"]);
    expect(store.rows[0]?.raw.portfolio.companies.map((c) => c.name)).toEqual(["Morlin GmbH"]);
  });

  it("uses the first row when a company appears twice in the operating table, and records an issue", async () => {
    const twice = { ...raw(), operating: { companies: [
      { name: "Morlin GmbH", revenue_ltm: v("100.8", 3), ebitda_ltm: v("12.8", 3), net_debt: v("-6.0", 3) },
      { name: "Morlin-GmbH", revenue_ltm: v("999.0", 3), ebitda_ltm: v("99.0", 3), net_debt: v("1.0", 3) },
    ] } };

    const { ctx } = await run({ raw: twice });

    expect(ctx.extraction?.portfolio_companies[0]?.revenue_ltm?.value).toBe(100_800_000);
    expect(ctx.normalizationIssues).toContainEqual(expect.objectContaining({ field: "operating", reason: expect.stringMatching(/Morlin GmbH.*more than once/) }));
  });

  it("keeps a figure the report does not state as null, without an issue", async () => {
    const { ctx } = await run({ raw: raw({ net_irr: v(null, null) }) });

    expect(ctx.extraction?.fund.net_irr).toBeNull();
    expect(ctx.normalizationIssues).toEqual([]);
  });

  it("records an unreadable figure as an issue instead of guessing", async () => {
    const { ctx } = await run({ raw: raw({ nav: v("four hundred") }) });

    expect(ctx.extraction?.fund.nav).toBeNull();
    expect(ctx.normalizationIssues).toEqual([{ field: "fund.nav", raw: "four hundred", reason: expect.stringMatching(/cannot read/) }]);
  });

  it("rejects a figure without a page reference, since every value must be traceable", async () => {
    const { ctx } = await run({ raw: raw({ nav: v("420.8", null) }) });

    expect(ctx.extraction?.fund.nav).toBeNull();
    expect(ctx.normalizationIssues?.[0]).toMatchObject({ field: "fund.nav", reason: expect.stringMatching(/page/) });
  });

  it("drops only a field that breaks the schema (a negative commitment), keeping every other value", async () => {
    const { ctx } = await run({ raw: raw({ commitment: v("(500.0)") }) });

    expect(ctx.extraction?.fund.commitment).toBeNull();
    expect(ctx.extraction?.fund.nav?.value).toBe(420_800_000);
    expect(ctx.normalizationIssues).toEqual([{ field: "fund.commitment", raw: "(500.0)", reason: expect.any(String) }]);
  });

  it("drops only the company figure that breaks the schema, keeping the company and its other values", async () => {
    const base = raw();
    const [first] = base.portfolio.companies;
    if (!first) throw new Error("fixture has no company");
    const company = { ...first, total_value: v("(86.8)", 2) };
    const { ctx } = await run({ raw: { ...base, portfolio: { companies: [company] } } });

    expect(ctx.extraction?.portfolio_companies[0]?.total_value).toBeNull();
    expect(ctx.extraction?.portfolio_companies[0]?.unrealized?.value).toBe(86_800_000);
    expect(ctx.normalizationIssues).toEqual([{ field: "portfolio_companies[0].total_value", raw: "(86.8)", reason: expect.any(String) }]);
  });

  it("treats an empty GP name as an incomplete classification", async () => {
    const { ctx } = await run({ classification: { ...classification, gp_name: "" } });

    expect(ctx.extraction).toBeNull();
    expect(ctx.normalizationIssues?.[0]?.field).toBe("classification");
  });

  it("drops blank narrative bullets instead of failing on them", async () => {
    const base = raw();
    const { ctx } = await run({ raw: { ...base, qualitative: { key_updates: ["  ", "Morlin GmbH appointed a new CFO"], outlook: null } } });

    expect(ctx.extraction?.qualitative.key_updates).toEqual(["Morlin GmbH appointed a new CFO"]);
  });

  it("produces no extraction when the classification is incomplete, and says why", async () => {
    const { ctx } = await run({ classification: { ...classification, currency: null, missing: ["currency"] } });

    expect(ctx.extraction).toBeNull();
    expect(ctx.normalizationIssues?.[0]?.reason).toMatch(/currency/);
  });

  it("runs the financial identity checks on the result", async () => {
    const { ctx, summary } = await run({ raw: raw({ tvpi: v("1.52x") }) });

    expect(ctx.checks?.find((c) => c.id === "tvpi_inconsistent")?.status).toBe("fail");
    expect(summary).toMatchObject({ checksFailed: expect.arrayContaining(["tvpi_inconsistent"]) });
  });

  it("stores the raw strings, the extraction and the checks as round 0", async () => {
    const { store, ctx } = await run();

    expect(store.rows).toEqual([{ run_id: "run-1", round: 0, raw: raw(), extraction: ctx.extraction, checks: ctx.checks }]);
  });
});
