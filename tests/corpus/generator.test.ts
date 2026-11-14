import { describe, expect, it } from "vitest";
import { generateFund } from "../../corpus/generator/model.ts";
import { PROFILES, profileById } from "../../corpus/generator/profiles.ts";
import { runIdentityChecks } from "../../core/checks/identities.ts";
import { Extraction, type Money } from "../../core/schema.ts";

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

function allMoney(e: Extraction): Money[] {
  const fundMoney = Object.values(e.fund).filter((f): f is Money => f !== null && "currency" in f);
  const companyMoney = e.portfolio_companies.flatMap((c) =>
    [c.invested, c.realized, c.unrealized, c.total_value, c.revenue_ltm, c.ebitda_ltm, c.net_debt]
      .filter((f): f is Money => f !== null));
  return [...fundMoney, ...companyMoney];
}

describe("generateFund", () => {
  it("is deterministic for a given profile and seed", () => {
    const profile = profileById("alpenrose-iv");

    expect(generateFund(profile, 7)).toEqual(generateFund(profile, 7));
  });

  it("produces different funds for different seeds", () => {
    const profile = profileById("alpenrose-iv");

    expect(generateFund(profile, 7)).not.toEqual(generateFund(profile, 8));
  });

  it("produces one extraction per quarter, oldest first", () => {
    const periods = generateFund(profileById("alpenrose-iv"), 1).map((q) => q.classification.period_end);

    expect(periods).toEqual(["2025-12-31", "2026-03-31", "2026-06-30"]);
  });

  it("produces only Q2 2026 for the unknown GP", () => {
    const periods = generateFund(profileById("tessera-seed-i"), 1).map((q) => q.classification.period_end);

    expect(periods).toEqual(["2026-06-30"]);
  });

  it("takes GP, fund and currency from the profile", () => {
    const profile = profileById("harbourline-ii");
    const [first] = generateFund(profile, 3);

    expect(first?.classification).toMatchObject({
      gp_name: profile.gp_name, fund_name: profile.fund_name, currency: profile.currency, report_type: "quarterly_report",
    });
  });

  it("gives every company a unique name with a legal-form suffix", () => {
    for (const profile of PROFILES) {
      const names = generateFund(profile, 11)[0]?.portfolio_companies.map((c) => c.name) ?? [];

      expect(new Set(names).size, profile.id).toBe(names.length);
      expect(names.length, profile.id).toBe(profile.companyCount);
      for (const name of names) expect(name, profile.id).toMatch(/ (GmbH|AG|S\.p\.A\.|Inc\.|Ltd|AB|AS|A\/S|Oy|SAS|SA)$/);
    }
  });

  it("rounds every amount to the profile's printed precision, so labels equal what is printed", () => {
    for (const profile of PROFILES) {
      for (const quarter of generateFund(profile, 5)) {
        for (const money of allMoney(quarter)) {
          expect(Math.abs(money.value % profile.roundTo), `${profile.id} ${money.value}`).toBe(0);
        }
      }
    }
  });

  it("places each figure on the page given by the profile layout", () => {
    const profile = profileById("alpenrose-iv");
    const [first] = generateFund(profile, 2);
    const company = first?.portfolio_companies[0];

    expect(first?.fund.nav?.source.page).toBe(profile.layout.fund);
    expect(company?.total_value?.source.page).toBe(profile.layout.companies);
    expect(company?.ebitda_ltm?.source.page).toBe(profile.layout.operating);
  });

  it("generates schema-valid, internally consistent funds across 50 seeds for every profile", () => {
    for (const profile of PROFILES) {
      for (const seed of SEEDS) {
        const quarters = generateFund(profile, seed);
        quarters.forEach((quarter, i) => {
          const where = `${profile.id} seed ${seed} ${quarter.classification.period_end}`;
          expect(Extraction.safeParse(quarter).success, where).toBe(true);

          const failures = runIdentityChecks(quarter, quarters[i - 1] ?? null).filter((c) => c.status === "fail");
          expect(failures.map((f) => `${f.id}: ${f.message}`), where).toEqual([]);
        });
      }
    }
  });
});
