import { describe, expect, it } from "vitest";
import { errorsByStep, reportDocument, renderMarkdown, type DocumentEvidence } from "../../../core/evals/report.ts";
import type { Extraction, PortfolioCompany } from "../../../core/schema.ts";

const m = (millions: number, page = 1) => ({ value: millions * 1e6, currency: "USD", source: { page } });
const r = (value: number) => ({ value, source: { page: 1 } });
const company = (name: string, ebitda: number): PortfolioCompany => ({ name, country: "US", sector: "Software", investment_date: null,
  invested: m(100, 2), realized: m(0, 2), unrealized: m(200, 2), total_value: m(200, 2), gross_moic: { value: 2, source: { page: 2 } },
  revenue_ltm: m(282.5, 3), ebitda_ltm: m(ebitda, 3), net_debt: m(10, 3) });
const extraction = (ebitda: number): Extraction => ({
  classification: { gp_name: "Harbourline Partners", fund_name: "Harbourline Growth II", period_end: "2025-09-30", report_type: "quarterly_report", currency: "USD" },
  fund: { commitment: m(750), paid_in: m(570.6), unfunded: m(179.4), distributions: m(82.6), nav: m(633.7), tvpi: r(1.38), dpi: r(0.14), rvpi: r(1.11), net_irr: r(0.04) },
  portfolio_companies: [company("Luori Inc.", ebitda)], qualitative: { key_updates: [], outlook: null },
});

const evidence = (over: Partial<DocumentEvidence> = {}): DocumentEvidence => ({
  doc_id: "scan", split: "dev", format: "scanned_pdf", expected: extraction(72.4), expected_route: "review",
  final: extraction(724), round0: extraction(724), route: "review",
  round0Raw: (path) => (path === "portfolio_companies[0].ebitda_ltm" ? "724" : null),
  pageText: (page) => (page === 3 ? "Luori Inc. 282.5 724 25.6%" : "other page"),
  printedForms: (_path, value) => [value === null ? "" : (value / 1e6).toFixed(1)],
  costUsd: 0.14, ...over,
});

describe("reportDocument", () => {
  it("scores the document and attributes each wrong value to its first bad step", () => {
    const report = reportDocument(evidence());

    expect(report).toMatchObject({ doc_id: "scan", keyFigures: { total: 7, correct: 7 }, allFigures: { total: 17, correct: 16 },
      routeOk: true, unsafe: false, costUsd: 0.14 });
    expect(report.errors).toEqual([{ path: "portfolio_companies[0].ebitda_ltm", label: "Luori Inc.: ebitda_ltm", key: false,
      expected: 72_400_000, actual: 724_000_000, step: 3 }]);
  });

  it("attributes a wrong route with right values to step 7", () => {
    const report = reportDocument(evidence({ final: extraction(72.4), round0: extraction(72.4), route: "auto_post" }));

    expect(report.errors).toEqual([{ path: "route", label: "route auto_post, expected review", key: true, expected: null, actual: null, step: 7 }]);
  });
});

describe("errorsByStep and the markdown summary", () => {
  it("counts errors per step and renders a readable report with the gate result", () => {
    const reports = [reportDocument(evidence())];
    const md = renderMarkdown({ version: "pipeline@test", generated_at: "2026-10-11", reports,
      summary: { documents: 1, unsafe: 0, keyFigureAccuracy: 1, allFigureAccuracy: 16 / 17, classificationAccuracy: 1, routeAccuracy: 1 },
      gate: { pass: true, failures: [] } });

    expect(errorsByStep(reports)).toEqual({ 3: 1 });
    expect(md).toMatch(/Gate: \*\*pass\*\*/);
    expect(md).toMatch(/\| 3 parse \/ OCR \| 1 \|/);
    expect(md).toMatch(/scan .*Luori Inc\.: ebitda_ltm.*724,000,000.*72,400,000.*step 3/);
  });
});
