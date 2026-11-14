import { describe, expect, it } from "vitest";
import {
  detectSeparators, normalizeAmount, normalizePercent, normalizeRatio, scaleFromUnitStatement, type Separators,
} from "../../../core/pipeline/normalize.ts";
import { formatAmount, formatPercent, formatRatio } from "../../../corpus/generator/format.ts";
import { generateFund } from "../../../corpus/generator/model.ts";
import { PROFILES } from "../../../corpus/generator/profiles.ts";

const US: Separators = { thousands: ",", decimal: "." };
const EU: Separators = { thousands: ".", decimal: "," };
const value = <T>(result: { ok: true; value: T } | { ok: false }) => (result.ok ? result.value : "ERROR");

describe("scaleFromUnitStatement", () => {
  it.each([
    ["All amounts in EUR m unless stated otherwise", 1e6],
    ["USD in millions", 1e6],
    ["EURm", 1e6],
    ["€m", 1e6],
    ["in EUR mn", 1e6],
    ["CHF Mio.", 1e6],
    ["TEUR", 1e3],
    ["kEUR", 1e3],
    ["CHF k", 1e3],
    ["in thousands of USD", 1e3],
    ["EUR bn", 1e9],
    ["USD", 1],
    ["Amounts in euro", 1],
  ])("reads %j as a scale of %d", (statement, scale) => {
    expect(value(scaleFromUnitStatement(statement))).toBe(scale);
  });

  it("refuses a statement that names two different scales", () => {
    expect(scaleFromUnitStatement("EUR m (operating metrics in TEUR)").ok).toBe(false);
  });

  it("treats a missing statement as plain units", () => {
    expect(value(scaleFromUnitStatement(null))).toBe(1);
  });
});

describe("detectSeparators", () => {
  it("reads US style from comma groups and dot decimals", () => {
    expect(value(detectSeparators(["1,352.4", "60.3", "(1.2)"]))).toEqual(US);
  });

  it("reads European style from dot groups and comma decimals", () => {
    expect(value(detectSeparators(["1.234,5", "60,3"]))).toEqual(EU);
  });

  it("treats a separator always followed by exactly three digits as a thousands separator", () => {
    // Nordkap prints TEUR without decimals: "400.000" means four hundred thousand, not 400.0.
    expect(value(detectSeparators(["400.000", "352.400", "850", "-6.000"]))).toEqual(EU);
  });

  it("reads Swiss apostrophe grouping", () => {
    expect(value(detectSeparators(["1'230", "80'000", "45.5"]))).toEqual({ thousands: "'", decimal: "." });
  });

  it("reads space grouping with comma decimals", () => {
    expect(value(detectSeparators(["1 234,5", "12 000"]))).toEqual({ thousands: " ", decimal: "," });
  });

  it("treats a no-break space (French-style grouping) like a space", () => {
    expect(value(detectSeparators(["1\u00a0234,5", "12\u202f000"]))).toEqual({ thousands: " ", decimal: "," });
    expect(value(normalizeAmount("1\u00a0234,5", 1e3, { thousands: " ", decimal: "," }))).toBe(1_234_500);
  });

  it("refuses a document where the same mark is a decimal in one number and a group in another", () => {
    expect(detectSeparators(["1.234.567", "35.4"]).ok).toBe(false);
  });

  it("refuses a document that uses two different decimal marks", () => {
    expect(detectSeparators(["1.5", "2,5"]).ok).toBe(false);
  });

  it("refuses a document that uses two different group marks", () => {
    expect(detectSeparators(["1,234,567", "7'500"]).ok).toBe(false);
  });

  it("defaults to US style when no number carries a separator", () => {
    expect(value(detectSeparators(["850", "-6", "12"]))).toEqual(US);
  });
});

describe("normalizeAmount", () => {
  it.each([
    ["352.4", 1e6, US, 352_400_000],
    ["1,352.4", 1e6, US, 1_352_400_000],
    ["(1.2)", 1e6, US, -1_200_000],
    ["-4.0", 1e6, US, -4_000_000],
    ["−4.0", 1e6, US, -4_000_000], // U+2212 minus
    ["4.0-", 1e6, US, -4_000_000], // trailing minus (SAP exports)
    ["1.234,5", 1e3, EU, 1_234_500],
    ["400.000", 1e3, EU, 400_000_000],
    ["1'230", 1e3, { thousands: "'", decimal: "." }, 1_230_000],
    ["12,345,678", 1, US, 12_345_678],
    ["EUR 352.4m", 1e6, US, 352_400_000],
    ["€ 352.4", 1e6, US, 352_400_000],
    ["352.4¹", 1e6, US, 352_400_000],
    ["352.4*", 1e6, US, 352_400_000],
    ["352.4 [2]", 1e6, US, 352_400_000],
    ["0.0", 1e6, US, 0],
  ])("reads %j (scale %d) as %d", (raw, scale, separators, expected) => {
    expect(value(normalizeAmount(raw, scale, separators))).toBe(expected);
  });

  it.each(["n/a", "N/A", "n.a.", "nm", "n.m.", "-", "–", "—", ""])("reads %j as not stated (null)", (raw) => {
    expect(value(normalizeAmount(raw, 1e6, US))).toBeNull();
  });

  it.each(["twelve", "12.3.4.5,6,7", "1.2.3"])("refuses %j instead of guessing", (raw) => {
    expect(normalizeAmount(raw, 1e6, US).ok).toBe(false);
  });

  it("lets a value's own scale suffix override the document scale", () => {
    expect(value(normalizeAmount("500m", 1e3, US))).toBe(500_000_000);
  });

  it("refuses a misplaced group mark instead of dropping it", () => {
    expect(normalizeAmount("1.2.3", 1e3, EU).ok).toBe(false);
  });

  it("avoids floating-point noise", () => {
    expect(value(normalizeAmount("0.3", 1e6, US))).toBe(300_000);
  });
});

describe("normalizeRatio and normalizePercent", () => {
  it.each([["1.40x", 1.4], ["1,40x", 1.4], ["1.4 x", 1.4], ["2.02×", 2.02], ["0.18X", 0.18], ["n/a", null]])(
    "ratio %j -> %s", (raw, expected) => expect(value(normalizeRatio(raw))).toBe(expected));

  it.each([["14.2%", 0.142], ["14,2 %", 0.142], ["-3.1%", -0.031], ["(3.1%)", -0.031], ["nm", null]])(
    "percent %j -> %s", (raw, expected) => expect(value(normalizePercent(raw))).toBe(expected));

  it("refuses a ratio without digits", () => {
    expect(normalizeRatio("high").ok).toBe(false);
  });
});

// The inverse of the formatter property test: whatever a corpus GP prints, step 5 reads back exactly the label value.
describe("round trip over every corpus style", () => {
  it("recovers every amount, ratio and IRR of every profile from its printed form", () => {
    for (const profile of PROFILES) {
      for (const quarter of generateFund(profile, 9)) {
        const amounts = [
          ...[quarter.fund.commitment, quarter.fund.paid_in, quarter.fund.unfunded, quarter.fund.distributions, quarter.fund.nav],
          ...quarter.portfolio_companies.flatMap((c) => [c.invested, c.realized, c.unrealized, c.total_value, c.revenue_ltm, c.ebitda_ltm, c.net_debt]),
        ].flatMap((m) => (m ? [m.value] : []));
        const printed = amounts.map((v) => formatAmount(v, profile.style));
        const separators = detectSeparators(printed);
        const scale = scaleFromUnitStatement(profile.style.unitLabel);
        if (!separators.ok || !scale.ok) throw new Error(`${profile.id}: separators or scale not detected`);

        printed.forEach((raw, i) => {
          expect(value(normalizeAmount(raw, scale.value, separators.value)), `${profile.id} ${raw}`).toBe(amounts[i]);
        });
        for (const r of [quarter.fund.tvpi, quarter.fund.dpi, quarter.fund.rvpi]) {
          if (r) expect(value(normalizeRatio(formatRatio(r.value))), profile.id).toBe(r.value);
        }
        if (quarter.fund.net_irr) {
          expect(value(normalizePercent(formatPercent(quarter.fund.net_irr.value))), profile.id).toBe(quarter.fund.net_irr.value);
        }
      }
    }
  });
});
