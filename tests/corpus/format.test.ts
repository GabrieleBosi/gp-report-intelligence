import { describe, expect, it } from "vitest";
import { formatAmount, formatPercent, formatPeriodLabel, formatLongDate, formatRatio, type NumberStyle } from "../../corpus/generator/format.ts";
import { generateFund } from "../../corpus/generator/model.ts";
import { PROFILES } from "../../corpus/generator/profiles.ts";

const MILLIONS: NumberStyle = { divisor: 1_000_000, decimals: 1, thousands: ",", decimal: ".", negative: "minus", unitLabel: "EUR m" };

describe("formatAmount", () => {
  it("prints millions with one decimal and thousands separators", () => {
    expect(formatAmount(1_352_400_000, MILLIONS)).toBe("1,352.4");
  });

  it("prints negatives with a leading minus", () => {
    expect(formatAmount(-4_000_000, MILLIONS)).toBe("-4.0");
  });

  it("prints negatives in parentheses when the style asks for it", () => {
    expect(formatAmount(-1_200_000, { ...MILLIONS, negative: "parentheses" })).toBe("(1.2)");
  });

  it("prints European separators", () => {
    const thousandsEu: NumberStyle = { divisor: 1_000, decimals: 0, thousands: ".", decimal: ",", negative: "minus", unitLabel: "EUR k" };
    expect(formatAmount(1_234_567_000, thousandsEu)).toBe("1.234.567");
    expect(formatAmount(1_234_500, { ...thousandsEu, decimals: 1 })).toBe("1.234,5");
  });

  it("prints zero without a sign", () => {
    expect(formatAmount(0, MILLIONS)).toBe("0.0");
  });
});

describe("ratio, percent and date formatting", () => {
  it("prints multiples with two decimals and an x", () => {
    expect(formatRatio(1.4)).toBe("1.40x");
  });

  it("prints multiples with the GP's decimal mark", () => {
    expect(formatRatio(1.4, ",")).toBe("1,40x");
  });

  it("prints percentages with the GP's decimal mark", () => {
    expect(formatPercent(0.071, 1, ",")).toBe("7,1%");
  });

  it("prints IRR as a one-decimal percentage", () => {
    expect(formatPercent(0.142)).toBe("14.2%");
    expect(formatPercent(-0.031)).toBe("-3.1%");
  });

  it("names the quarter of a period end", () => {
    expect(formatPeriodLabel("2026-06-30")).toBe("Q2 2026");
    expect(formatPeriodLabel("2025-12-31")).toBe("Q4 2025");
  });

  it("prints a long English date", () => {
    expect(formatLongDate("2026-06-30")).toBe("30 June 2026");
  });
});

// The label must equal what is printed: parsing the printed digits back must give the label value exactly.
describe("printed amounts round-trip to label values", () => {
  function parsePrinted(text: string, style: NumberStyle): number {
    const negative = text.startsWith("-") || text.startsWith("(");
    const digits = text.replace(/[()-]/g, "").split(style.thousands).join("").replace(style.decimal, ".");
    return (negative ? -1 : 1) * Math.round(Number(digits) * style.divisor);
  }

  it("holds for every amount of every profile", () => {
    for (const profile of PROFILES) {
      for (const quarter of generateFund(profile, 3)) {
        const amounts = [
          ...Object.values(quarter.fund),
          ...quarter.portfolio_companies.flatMap((c) => [c.invested, c.realized, c.unrealized, c.total_value, c.revenue_ltm, c.ebitda_ltm, c.net_debt]),
        ].filter((f): f is { value: number; currency: string; source: { page: number } } => f !== null && "currency" in f);

        for (const { value } of amounts) {
          const printed = formatAmount(value, profile.style);
          expect(parsePrinted(printed, profile.style), `${profile.id} ${printed}`).toBe(value);
        }
      }
    }
  });
});
