import { describe, expect, it } from "vitest";
import { attribute, attributeRoute } from "../../../core/evals/first-bad-step.ts";
import { checkGate } from "../../../core/evals/gate.ts";
import { compareDocument, summarize } from "../../../core/evals/metrics.ts";
import type { Extraction, PortfolioCompany } from "../../../core/schema.ts";

const m = (millions: number) => ({ value: millions * 1e6, currency: "EUR", source: { page: 1 } });
const r = (value: number) => ({ value, source: { page: 1 } });
const company = (name: string, total: number, ebitda = 10): PortfolioCompany => ({
  name, country: "AT", sector: "Industrials", investment_date: null, invested: m(100), realized: m(0), unrealized: m(total),
  total_value: m(total), gross_moic: r(total / 100), revenue_ltm: m(100), ebitda_ltm: m(ebitda), net_debt: m(5),
});
const label = (): Extraction => ({
  classification: { gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", report_type: "quarterly_report", currency: "EUR" },
  fund: { commitment: m(500), paid_in: m(330.5), unfunded: m(169.5), distributions: m(60), nav: m(420.8), tvpi: r(1.45), dpi: r(0.18), rvpi: r(1.27), net_irr: r(0.071) },
  portfolio_companies: [company("A GmbH", 210.4), company("B AG", 210.4)], qualitative: { key_updates: [], outlook: null },
});

describe("compareDocument", () => {
  it("counts every key figure and every figure right on an exact extraction", () => {
    const result = compareDocument(label(), label(), "auto_post", "auto_post");

    expect(result).toMatchObject({ keyFigures: { total: 8, correct: 8 }, allFigures: { total: 25, correct: 25 },
      classificationOk: true, routeOk: true, unsafe: false });
  });

  it("finds a wrong key figure, a wrong operating figure and a missing company, matched by name", () => {
    const actual = label();
    actual.fund.nav = m(421.8);
    actual.portfolio_companies = [company("b ag", 210.4, 99)]; // A GmbH missing; B AG's EBITDA wrong

    const result = compareDocument(label(), actual, "review", "auto_post");

    expect(result.keyFigures.wrong.map((w) => w.path)).toEqual(["fund.nav", "portfolio_companies[0].total_value"]);
    expect(result.allFigures.wrong.map((w) => w.path)).toEqual(expect.arrayContaining(["portfolio_companies[1].ebitda_ltm", "portfolio_companies[0].invested"]));
    expect(result.keyFigures.wrong[0]).toEqual({ path: "fund.nav", label: "nav", expected: 420_800_000, actual: 421_800_000 });
    expect(result.routeOk).toBe(false);
  });

  it("calls an auto-post with any wrong key figure unsafe, and a review with a wrong figure safe", () => {
    const actual = label();
    actual.fund.tvpi = r(1.46);

    expect(compareDocument(label(), actual, "auto_post", "auto_post").unsafe).toBe(true);
    expect(compareDocument(label(), actual, "review", "auto_post").unsafe).toBe(false);
  });

  it("checks the classification and handles a run that extracted nothing", () => {
    const wrongFund = label();
    wrongFund.classification.fund_name = "Alpenrose Buyout V";

    expect(compareDocument(label(), wrongFund, "review", "review")).toMatchObject({ classificationOk: false, classificationDiffs: ["fund_name"] });
    expect(compareDocument(label(), null, "triage", "triage")).toMatchObject({ keyFigures: { correct: 0, total: 8 }, classificationOk: false, routeOk: true, unsafe: false });
  });
});

describe("summarize", () => {
  it("totals the documents", () => {
    const ok = compareDocument(label(), label(), "auto_post", "auto_post");
    const bad = compareDocument(label(), null, "triage", "auto_post");

    expect(summarize([ok, bad])).toEqual({ documents: 2, unsafe: 0, keyFigureAccuracy: 0.5, allFigureAccuracy: 0.5,
      classificationAccuracy: 0.5, routeAccuracy: 0.5 });
  });
});

describe("attribute: the first bad step for a wrong value", () => {
  const base = { printedForms: ["72.4"], pageText: "Luori Inc. 282.5 72.4 25.6%", round0Raw: "72.4", round0Value: 72_400_000, expected: 72_400_000 };

  it.each([
    ["3 parse/OCR: the printed value is not in the page text", { pageText: "Luori Inc. 282.5 724 25.6%", round0Raw: "724", round0Value: 724_000_000 }, 3],
    ["4 extract: the text is right, the first read is not", { round0Raw: "27.4", round0Value: 27_400_000 }, 4],
    ["5 normalize: the raw string is right, its value is not", { round0Value: 7_240_000 }, 5],
    ["6 critic: right at round 0, wrong at the end", {}, 6],
  ] as const)("step %s", (_, over, step) => {
    expect(attribute({ ...base, ...over })).toBe(step);
  });

  it("does not mistake another number containing the value for it (17.5 inside another row's 17.5%)", () => {
    const page = "Tovbren Inc. 127.2 222 17.5% 69.1\nTracen Inc. 104.1 175 16.8% (8.5)";

    expect(attribute({ ...base, printedForms: ["17.5"], expected: 17_500_000, pageText: page, round0Raw: "175", round0Value: 175_000_000, row: "Tracen Inc." })).toBe(3);
    expect(attribute({ ...base, printedForms: ["17.5"], expected: 17_500_000, pageText: "Tracen Inc. 17.5% margin", round0Raw: "175", round0Value: 175_000_000 })).toBe(3);
  });

  it("finds the printed value despite spacing differences in OCR text", () => {
    expect(attribute({ ...base, pageText: "Luori Inc.  282.5   72.4  25.6%", round0Raw: "27.4", round0Value: 27_400_000 })).toBe(4);
  });

  it("puts a wrong route with every key figure right on step 7, and classification errors on step 2", () => {
    expect(attributeRoute({ routeOk: false, keyFiguresRight: true, classificationOk: true })).toBe(7);
    expect(attributeRoute({ routeOk: false, keyFiguresRight: true, classificationOk: false })).toBe(2);
    expect(attributeRoute({ routeOk: false, keyFiguresRight: false, classificationOk: true })).toBeNull(); // explained by the values
    expect(attributeRoute({ routeOk: true, keyFiguresRight: true, classificationOk: true })).toBeNull();
  });
});

describe("checkGate", () => {
  const baseline = { documents: 12, unsafe: 0, keyFigureAccuracy: 1, allFigureAccuracy: 0.98, classificationAccuracy: 1, routeAccuracy: 11 / 12 };

  it("passes at or above the baseline, reporting the all-figure metric without gating it", () => {
    expect(checkGate({ ...baseline, allFigureAccuracy: 0.9 }, baseline)).toEqual({ pass: true, failures: [] });
  });

  it("fails on any unsafe auto-post, and on a gated metric below the baseline", () => {
    expect(checkGate({ ...baseline, unsafe: 1 }, baseline).failures).toEqual(["1 unsafe auto-post (must be 0)"]);
    expect(checkGate({ ...baseline, keyFigureAccuracy: 0.99, routeAccuracy: 10 / 12 }, baseline)).toEqual({ pass: false, failures: [
      "key-figure accuracy 99.0% < baseline 100.0%", "route accuracy 83.3% < baseline 91.7%",
    ] });
  });
});
