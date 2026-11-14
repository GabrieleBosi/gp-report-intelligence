import { describe, expect, it } from "vitest";
import { buildGolden, type HarvestedCorrection } from "../../../core/evals/golden.ts";
import type { CorpusLabel, PortfolioCompany } from "../../../core/schema.ts";

const m = (millions: number, page = 3) => ({ value: millions * 1e6, currency: "USD", source: { page } });
const company = (name: string, ebitda: number): PortfolioCompany => ({ name, country: "US", sector: "Software", investment_date: null,
  invested: m(1, 2), realized: m(0, 2), unrealized: m(1, 2), total_value: m(1, 2), gross_moic: { value: 1, source: { page: 2 } },
  revenue_ltm: m(282.5), ebitda_ltm: m(ebitda), net_debt: m(1) });
const label = (doc_id: string, split: "dev" | "heldout" = "dev") => ({
  doc_id, file: `corpus/docs/${doc_id}.pdf`, split, format: "scanned_pdf", expected_route: "review", expected_flags: [],
  expected: { classification: { gp_name: "G", fund_name: "F", period_end: "2025-09-30", report_type: "quarterly_report", currency: "USD" },
    fund: { commitment: null, paid_in: null, unfunded: null, distributions: null, nav: null, tvpi: null, dpi: null, rvpi: null, net_irr: null },
    portfolio_companies: [company("Luori Inc.", 72.4)], qualitative: { key_updates: [], outlook: null } },
}) as unknown as CorpusLabel;
const correction = (over: Partial<HarvestedCorrection> = {}): HarvestedCorrection => ({
  document_sha256: "s1", filename: "scan.pdf", corpus_doc_id: "scan", field: "portfolio_companies[0].ebitda_ltm",
  raw: "72.4", page: 3, value: 72_400_000, analyst: "E2E analyst", decided_at: "2026-10-11T12:00:00Z", ...over,
});

describe("buildGolden", () => {
  it("keeps every labelled document with its split, and a correction that agrees with the label", () => {
    const golden = buildGolden([label("scan"), label("other", "heldout")], [correction()]);

    expect(golden.documents.map((d) => [d.doc_id, d.split])).toEqual([["other", "heldout"], ["scan", "dev"]]);
    expect(golden.corrections).toEqual([expect.objectContaining({ doc_id: "scan", field: "portfolio_companies[0].ebitda_ltm",
      expected_raw: "72.4", expected_value: 72_400_000, page: 3, agrees_with_label: true, times: 1 })]);
    expect(golden.disagreements).toEqual([]);
  });

  it("merges identical corrections (the same fix made again) and counts them", () => {
    const golden = buildGolden([label("scan")], [correction(), correction({ decided_at: "2026-10-11T13:00:00Z" })]);

    expect(golden.corrections).toHaveLength(1);
    expect(golden.corrections[0]).toMatchObject({ times: 2, last_decided_at: "2026-10-11T13:00:00Z" });
  });

  it("reports a correction that disagrees with the corpus label instead of trusting it", () => {
    const golden = buildGolden([label("scan")], [correction({ raw: "74.2", value: 74_200_000 })]);

    expect(golden.corrections[0]?.agrees_with_label).toBe(false);
    expect(golden.disagreements).toEqual([{ doc_id: "scan", field: "portfolio_companies[0].ebitda_ltm", label_value: 72_400_000, corrected_value: 74_200_000, analyst: "E2E analyst" }]);
  });

  it("keeps a correction on an upload (no label) as the only ground truth there is", () => {
    const golden = buildGolden([], [correction({ corpus_doc_id: null, filename: "q3.pdf", document_sha256: "u1" })]);

    expect(golden.corrections[0]).toMatchObject({ doc_id: null, filename: "q3.pdf", agrees_with_label: null });
  });
});
