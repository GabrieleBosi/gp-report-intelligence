import { describe, expect, it } from "vitest";
import { runIdentityChecks, type CheckResult } from "../../core/checks/identities.ts";
import type { Extraction, PortfolioCompany } from "../../core/schema.ts";

const m = (millions: number, currency = "EUR") => ({ value: millions * 1_000_000, currency, source: { page: 1 } });
const r = (value: number) => ({ value, source: { page: 1 } });

function company(name: string, invested: number, realized: number, unrealized: number, moic: number): PortfolioCompany {
  return {
    name, sector: "Industrials", country: "DE", investment_date: "2022-01-31",
    invested: m(invested), realized: m(realized), unrealized: m(unrealized), total_value: m(realized + unrealized),
    gross_moic: r(moic), revenue_ltm: null, ebitda_ltm: null, net_debt: null,
  };
}

// Consistent by hand: TVPI (96+352)/320 = 1.40, DPI 96/320 = 0.30, RVPI 352/320 = 1.10,
// unfunded 500-320 = 180, sum of unrealized 350 vs NAV 352 (0.6% gap).
function consistentFund(): Extraction {
  return {
    classification: { gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", report_type: "quarterly_report", currency: "EUR" },
    fund: {
      commitment: m(500), paid_in: m(320), unfunded: m(180), distributions: m(96), nav: m(352),
      tvpi: r(1.4), dpi: r(0.3), rvpi: r(1.1), net_irr: r(0.142),
    },
    portfolio_companies: [
      company("Velmora GmbH", 60, 0, 120, 2.0),
      company("Quintaro AG", 90, 40, 130, 1.89),
      company("Brenvik AB", 80, 56, 100, 1.95),
    ],
    qualitative: { key_updates: [], outlook: null },
  };
}

function nth<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`fixture has no item ${index}`);
  return item;
}

const failed = (results: CheckResult[]) => results.filter((c) => c.status === "fail").map((c) => c.id);

describe("runIdentityChecks on a single quarter", () => {
  it("passes every check on a consistent fund", () => {
    expect(failed(runIdentityChecks(consistentFund()))).toEqual([]);
  });

  it("flags only tvpi_inconsistent when the printed TVPI is wrong (corpus trap 1)", () => {
    const fund = consistentFund();
    fund.fund.tvpi = r(1.52);

    expect(failed(runIdentityChecks(fund))).toEqual(["tvpi_inconsistent"]);
  });

  it("names the fields involved in a failed check, so step 7 can lower their confidence", () => {
    const fund = consistentFund();
    fund.fund.tvpi = r(1.52);

    const tvpi = runIdentityChecks(fund).find((c) => c.id === "tvpi_inconsistent");
    expect(tvpi?.fields).toEqual(["fund.tvpi", "fund.distributions", "fund.nav", "fund.paid_in"]);
  });

  it("tolerates two-decimal rounding of printed ratios", () => {
    const fund = consistentFund();
    fund.fund.tvpi = r(1.405);

    expect(failed(runIdentityChecks(fund))).toEqual([]);
  });

  it("flags only dpi_inconsistent when the printed DPI is wrong", () => {
    const fund = consistentFund();
    fund.fund.dpi = r(0.35);

    expect(failed(runIdentityChecks(fund))).toEqual(["dpi_inconsistent"]);
  });

  it("flags only rvpi_inconsistent when the printed RVPI is wrong", () => {
    const fund = consistentFund();
    fund.fund.rvpi = r(1.0);

    expect(failed(runIdentityChecks(fund))).toEqual(["rvpi_inconsistent"]);
  });

  it("flags paid-in above commitment", () => {
    const fund = consistentFund();
    fund.fund.commitment = m(300);
    fund.fund.unfunded = m(-20);

    expect(failed(runIdentityChecks(fund))).toEqual(["paid_in_exceeds_commitment"]);
  });

  it("flags unfunded that does not equal commitment minus paid-in", () => {
    const fund = consistentFund();
    fund.fund.unfunded = m(150);

    expect(failed(runIdentityChecks(fund))).toEqual(["unfunded_inconsistent"]);
  });

  it("flags a NAV more than 10% away from the sum of company unrealized values", () => {
    const fund = consistentFund();
    // Shrink one holding by 100m (keeping its own identities intact): sum 250 vs NAV 352.
    fund.portfolio_companies[0] = company("Velmora GmbH", 60, 0, 20, 0.33);

    expect(failed(runIdentityChecks(fund))).toEqual(["nav_bridge_gap"]);
  });

  it("flags a company whose total value is not realized plus unrealized", () => {
    const fund = consistentFund();
    const quintaro = nth(fund.portfolio_companies, 1);
    // MOIC kept consistent with the wrong total (190 / 90 = 2.11) so only the value identity breaks.
    fund.portfolio_companies[1] = { ...quintaro, total_value: m(190), gross_moic: r(2.11) };

    const results = runIdentityChecks(fund);
    expect(failed(results)).toEqual(["company_value_inconsistent"]);
    expect(results.find((c) => c.id === "company_value_inconsistent")?.fields).toContain("portfolio_companies[1].total_value");
  });

  it("names every company figure a passing company check examined, so confidence knows they are covered", () => {
    const check = runIdentityChecks(consistentFund()).find((c) => c.id === "company_value_inconsistent");

    expect(check?.status).toBe("pass");
    expect(check?.fields).toContain("portfolio_companies[2].total_value");
  });

  it("lists only the failing company's figures as failing, so the critic re-reads just those", () => {
    const fund = consistentFund();
    fund.portfolio_companies[1] = { ...nth(fund.portfolio_companies, 1), total_value: m(190), gross_moic: r(2.11) };

    const check = runIdentityChecks(fund).find((c) => c.id === "company_value_inconsistent");
    expect(check?.failing).toEqual(["portfolio_companies[1].total_value", "portfolio_companies[1].realized", "portfolio_companies[1].unrealized"]);
    expect(check?.fields).toContain("portfolio_companies[0].total_value");
  });

  it("flags a company whose EBITDA exceeds its revenue (e.g. an OCR-dropped decimal: 72.4 read as 724), naming only that company", () => {
    const fund = consistentFund();
    const withOps = (c: PortfolioCompany, revenue: number, ebitda: number) => ({ ...c, revenue_ltm: m(revenue), ebitda_ltm: m(ebitda) });
    fund.portfolio_companies = [withOps(nth(fund.portfolio_companies, 0), 300, 72.4), withOps(nth(fund.portfolio_companies, 1), 300, 724),
      withOps(nth(fund.portfolio_companies, 2), 50, -4)];

    const check = runIdentityChecks(fund).find((c) => c.id === "company_ebitda_exceeds_revenue");
    expect(check).toMatchObject({ status: "fail", failing: ["portfolio_companies[1].ebitda_ltm", "portfolio_companies[1].revenue_ltm"] });
    expect(check?.fields).toContain("portfolio_companies[0].ebitda_ltm");
    expect(failed(runIdentityChecks(fund))).toEqual(["company_ebitda_exceeds_revenue"]);
  });

  it("skips the EBITDA check when no company reports revenue and EBITDA", () => {
    expect(runIdentityChecks(consistentFund()).find((c) => c.id === "company_ebitda_exceeds_revenue")?.status).toBe("skipped");
  });

  it("flags a company whose gross MOIC does not match total value over invested", () => {
    const fund = consistentFund();
    const brenvik = nth(fund.portfolio_companies, 2);
    fund.portfolio_companies[2] = { ...brenvik, gross_moic: r(2.4) };

    expect(failed(runIdentityChecks(fund))).toEqual(["company_moic_inconsistent"]);
  });

  it("flags an amount reported in a different currency from the report", () => {
    const fund = consistentFund();
    fund.fund.nav = m(352, "USD");

    expect(failed(runIdentityChecks(fund))).toEqual(["currency_mismatch"]);
  });

  it("skips a check whose inputs were not extracted, instead of failing it", () => {
    const fund = consistentFund();
    fund.fund.tvpi = null;

    const tvpi = runIdentityChecks(fund).find((c) => c.id === "tvpi_inconsistent");
    expect(tvpi?.status).toBe("skipped");
    expect(failed(runIdentityChecks(fund))).toEqual([]);
  });

  it("fails the NAV bridge when the fund reports a NAV but no portfolio company was extracted", () => {
    const fund = consistentFund();
    fund.portfolio_companies = [];

    const bridge = runIdentityChecks(fund).find((c) => c.id === "nav_bridge_gap");
    expect(bridge).toMatchObject({ status: "fail", fields: ["fund.nav"] });
    expect(bridge?.message).toMatch(/no portfolio companies/);
  });

  it("skips the NAV bridge when any company's unrealized value was not extracted", () => {
    const fund = consistentFund();
    fund.portfolio_companies[0] = { ...nth(fund.portfolio_companies, 0), unrealized: null };

    const bridge = runIdentityChecks(fund).find((c) => c.id === "nav_bridge_gap");
    expect(bridge?.status).toBe("skipped");
  });

  it("skips quarter-on-quarter checks when there is no previous quarter", () => {
    const qoq = runIdentityChecks(consistentFund()).filter((c) => c.id.startsWith("qoq_"));

    expect(qoq.length).toBeGreaterThan(0);
    expect(qoq.every((c) => c.status === "skipped")).toBe(true);
  });
});

describe("runIdentityChecks against the previous quarter", () => {
  function previousQuarter(): Extraction {
    const prev = consistentFund();
    prev.classification.period_end = "2026-03-31";
    prev.fund.paid_in = m(300);
    prev.fund.distributions = m(80);
    prev.fund.nav = m(330);
    return prev;
  }

  it("passes when cumulative figures grow and NAV moves plausibly", () => {
    expect(failed(runIdentityChecks(consistentFund(), previousQuarter()))).toEqual([]);
  });

  it("flags cumulative distributions that went down", () => {
    const prev = previousQuarter();
    prev.fund.distributions = m(110);

    expect(failed(runIdentityChecks(consistentFund(), prev))).toEqual(["qoq_cumulative_decrease"]);
  });

  it("flags a commitment that changed between quarters", () => {
    const prev = previousQuarter();
    prev.fund.commitment = m(450);
    prev.fund.unfunded = m(150);

    expect(failed(runIdentityChecks(consistentFund(), prev))).toEqual(["qoq_commitment_changed"]);
  });

  it("flags a NAV move of more than 40% in one quarter", () => {
    const prev = previousQuarter();
    prev.fund.nav = m(200);

    expect(failed(runIdentityChecks(consistentFund(), prev))).toEqual(["qoq_nav_jump"]);
  });
});
