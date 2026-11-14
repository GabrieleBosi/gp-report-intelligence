import { describe, expect, it } from "vitest";
import { CorpusLabel, Extraction, FUND_KEY_FIGURES } from "../../core/schema.ts";

const money = (value: number, page = 1) => ({ value, currency: "EUR", source: { page } });
const ratio = (value: number, page = 1) => ({ value, source: { page } });

function validExtraction() {
  return {
    classification: {
      gp_name: "Alpenrose Capital",
      fund_name: "Alpenrose Buyout IV",
      period_end: "2026-06-30",
      report_type: "quarterly_report",
      currency: "EUR",
    },
    fund: {
      commitment: money(500_000_000),
      paid_in: money(320_000_000),
      unfunded: money(180_000_000),
      distributions: money(96_000_000),
      nav: money(352_000_000),
      tvpi: ratio(1.4),
      dpi: ratio(0.3),
      rvpi: ratio(1.1),
      net_irr: ratio(0.142),
    },
    portfolio_companies: [
      {
        name: "Fictional Pumps GmbH",
        sector: "Industrials",
        country: "DE",
        investment_date: "2022-03-15",
        invested: money(60_000_000, 3),
        realized: money(0, 3),
        unrealized: money(84_000_000, 3),
        total_value: money(84_000_000, 3),
        gross_moic: ratio(1.4, 3),
        revenue_ltm: money(210_000_000, 4),
        ebitda_ltm: money(31_500_000, 4),
        net_debt: money(-4_000_000, 4),
      },
    ],
    qualitative: { key_updates: ["Completed add-on acquisition in Austria"], outlook: null },
  };
}

describe("Extraction schema v1", () => {
  it("accepts a complete, valid extraction", () => {
    expect(Extraction.safeParse(validExtraction()).success).toBe(true);
  });

  it("accepts null for a figure the report does not state", () => {
    const input = validExtraction();
    const withoutIrr = { ...input, fund: { ...input.fund, net_irr: null } };

    expect(Extraction.safeParse(withoutIrr).success).toBe(true);
  });

  it("accepts negative net debt (a net cash position)", () => {
    const parsed = Extraction.parse(validExtraction());

    expect(parsed.portfolio_companies[0]?.net_debt?.value).toBe(-4_000_000);
  });

  it("rejects a money value without a currency", () => {
    const input = validExtraction();
    const noCurrency = { ...input, fund: { ...input.fund, nav: { value: 1, source: { page: 1 } } } };

    expect(Extraction.safeParse(noCurrency).success).toBe(false);
  });

  it("rejects a lowercase or non-3-letter currency code", () => {
    const input = validExtraction();

    for (const currency of ["eur", "EURO", "€"]) {
      const bad = { ...input, classification: { ...input.classification, currency } };
      expect(Extraction.safeParse(bad).success, currency).toBe(false);
    }
  });

  it("rejects an impossible or non-ISO period end date", () => {
    const input = validExtraction();

    for (const period_end of ["2026-02-30", "30/06/2026", "Q2 2026"]) {
      const bad = { ...input, classification: { ...input.classification, period_end } };
      expect(Extraction.safeParse(bad).success, period_end).toBe(false);
    }
  });

  it("rejects a negative commitment", () => {
    const input = validExtraction();
    const negative = { ...input, fund: { ...input.fund, commitment: money(-1) } };

    expect(Extraction.safeParse(negative).success).toBe(false);
  });

  it("rejects a source page below 1", () => {
    const input = validExtraction();
    const pageZero = { ...input, fund: { ...input.fund, nav: money(352_000_000, 0) } };

    expect(Extraction.safeParse(pageZero).success).toBe(false);
  });

  it("rejects an unknown report type", () => {
    const input = validExtraction();
    const bad = { ...input, classification: { ...input.classification, report_type: "annual_letter" } };

    expect(Extraction.safeParse(bad).success).toBe(false);
  });
});

describe("FUND_KEY_FIGURES", () => {
  it("lists the fund figures that get the dual read in step 7", () => {
    expect(FUND_KEY_FIGURES).toEqual(["commitment", "paid_in", "distributions", "nav", "tvpi", "dpi"]);
  });
});

describe("CorpusLabel", () => {
  const label = {
    doc_id: "alpenrose-iv-2026q2",
    file: "corpus/docs/alpenrose-iv-2026q2.pdf",
    split: "dev",
    format: "native_pdf",
    expected: validExtraction(),
    expected_flags: [],
    expected_route: "auto_post",
  };

  it("accepts a valid label", () => {
    expect(CorpusLabel.safeParse(label).success).toBe(true);
  });

  it("rejects a split other than dev or heldout", () => {
    expect(CorpusLabel.safeParse({ ...label, split: "train" }).success).toBe(false);
  });

  it("rejects a doc_id that is not kebab-case", () => {
    expect(CorpusLabel.safeParse({ ...label, doc_id: "Alpenrose IV" }).success).toBe(false);
  });

  it("rejects an unknown route", () => {
    expect(CorpusLabel.safeParse({ ...label, expected_route: "maybe" }).success).toBe(false);
  });
});
