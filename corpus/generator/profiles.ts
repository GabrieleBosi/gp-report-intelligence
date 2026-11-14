// The fictional universe (SPEC-corpus "Fictional universe"). Profiles are data only: the model reads the
// economics, and the renderers read the presentation fields (style, layout).
import type { NumberStyle } from "./format.ts";
import type { ReportVocabulary } from "./vocabulary.ts";

export type GpProfile = {
  id: string;
  gp_name: string;
  fund_name: string;
  currency: string;
  commitment: number; // full units
  vintage: number;
  companyCount: number;
  periods: string[]; // quarter ends, oldest first
  roundTo: number; // printed precision in full units: 100_000 = "12.3m", 1_000 = "12,345k", 1 = exact (XLSX)
  style: NumberStyle; // must print exactly roundTo precision, so labels equal what is printed
  layout: { fund: number; companies: number; operating: number }; // page of each section
  countries: string[];
  sectors: string[];
  knownGp: boolean;
  vocabulary?: Partial<ReportVocabulary>; // wording that differs from the default (Alpenrose) report
  orientation?: "portrait" | "landscape";
  reportType?: "capital_account_statement"; // what the document calls itself; default quarterly_report
};

const QUARTERS = ["2025-12-31", "2026-03-31", "2026-06-30"];
const STANDARD_LAYOUT = { fund: 1, companies: 2, operating: 3 };

export const PROFILES: GpProfile[] = [
  {
    id: "alpenrose-iv", gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", currency: "EUR",
    commitment: 500_000_000, vintage: 2021, companyCount: 6, periods: QUARTERS, roundTo: 100_000,
    style: { divisor: 1_000_000, decimals: 1, thousands: ",", decimal: ".", negative: "minus", unitLabel: "EUR m" },
    layout: STANDARD_LAYOUT, countries: ["DE", "AT", "CH", "IT"],
    sectors: ["Industrials", "Healthcare", "Business Services", "Consumer"], knownGp: true,
  },
  {
    id: "harbourline-ii", gp_name: "Harbourline Partners", fund_name: "Harbourline Growth II", currency: "USD",
    commitment: 750_000_000, vintage: 2020, companyCount: 7, periods: QUARTERS, roundTo: 100_000,
    style: { divisor: 1_000_000, decimals: 1, thousands: ",", decimal: ".", negative: "parentheses", unitLabel: "USD m" },
    layout: STANDARD_LAYOUT, countries: ["US", "GB", "CA"],
    sectors: ["Software", "Fintech", "Healthcare IT", "Marketplaces"], knownGp: true,
    vocabulary: {
      titleSuffix: "Quarterly Investor Report",
      reportingLine: (date, unit) => `As of ${date} | ${unit}, except multiples and percentages`,
      fundHeading: "Capital account summary",
      commitment: "Total Commitment", paidIn: "Contributed Capital", unfunded: "Remaining Commitment",
      distributions: "Distributions to Date", nav: "Net Asset Value",
      performanceHeading: "Fund performance", tvpi: "Net TVPI", dpi: "Net DPI", rvpi: "Net RVPI", irr: "Net IRR",
      updatesHeading: "Quarter highlights", outlookHeading: "Looking ahead",
      portfolioHeading: (unit) => `Portfolio summary (${unit})`,
      portfolioColumns: ["Company", "HQ", "Sector", "Cost", "Proceeds", "Fair value", "Total value", "MOIC"],
      totalRow: "Total",
      operatingHeading: (unit) => `Portfolio company financials, LTM (${unit})`,
    },
  },
  {
    id: "nordkap-iii", gp_name: "Nordkap Equity", fund_name: "Nordkap Mid-Market III", currency: "EUR",
    commitment: 400_000_000, vintage: 2022, companyCount: 5, periods: QUARTERS, roundTo: 1_000,
    style: { divisor: 1_000, decimals: 0, thousands: ".", decimal: ",", negative: "minus", unitLabel: "TEUR" },
    layout: STANDARD_LAYOUT, countries: ["SE", "NO", "DK", "FI"],
    sectors: ["Industrials", "Energy Transition", "Business Services"], knownGp: true,
    orientation: "landscape",
    vocabulary: {
      reportingLine: (date, unit) => `Reporting period ending ${date}. Figures in ${unit} (thousand euros).`,
      fundHeading: "Fund key figures",
      commitment: "Committed capital", paidIn: "Called capital", unfunded: "Uncalled capital",
      distributions: "Distributed capital", nav: "Net asset value (NAV)",
      performanceHeading: "Multiples and returns (net)", irr: "Net IRR (since inception)",
      updatesHeading: "Highlights",
      portfolioHeading: (unit) => `Portfolio holdings (${unit})`,
      portfolioColumns: ["Holding", "Country", "Sector", "Invested", "Realised", "Unrealised", "Total value", "Gross MOIC"],
      totalRow: "Total holdings",
      operatingHeading: (unit) => `Holdings: key financials, last twelve months (${unit})`,
    },
  },
  {
    id: "meridian-i", gp_name: "Meridian Growth", fund_name: "Meridian Tech Opportunities I", currency: "USD",
    reportType: "capital_account_statement",
    commitment: 300_000_000, vintage: 2021, companyCount: 5, periods: QUARTERS, roundTo: 1,
    style: { divisor: 1, decimals: 0, thousands: ",", decimal: ".", negative: "minus", unitLabel: "USD" },
    // A workbook: "page" is the 1-based sheet number (render-xlsx.ts).
    layout: { fund: 1, companies: 2, operating: 2 }, countries: ["US", "GB"],
    sectors: ["Software", "Cybersecurity", "Data Infrastructure"], knownGp: true,
  },
  {
    id: "tessera-seed-i", gp_name: "Tessera Ventures", fund_name: "Tessera Seed Fund I", currency: "CHF",
    commitment: 80_000_000, vintage: 2023, companyCount: 8, periods: ["2026-06-30"], roundTo: 10_000,
    style: { divisor: 1_000, decimals: 0, thousands: "'", decimal: ".", negative: "minus", unitLabel: "CHF k" },
    layout: { fund: 1, companies: 1, operating: 2 }, countries: ["CH", "DE", "FR"],
    sectors: ["Deep Tech", "Climate", "Digital Health"], knownGp: false,
    vocabulary: {
      titleSuffix: "LP Update",
      reportingLine: (date, unit) => `Period end ${date} · amounts in ${unit}`,
      fundHeading: "Fund at a glance",
      commitment: "Commitments", paidIn: "Capital called", unfunded: "Capital to be called",
      distributions: "Distributions", nav: "Portfolio NAV",
      performanceHeading: "Returns", tvpi: "TVPI (net)", dpi: "DPI (net)", rvpi: "RVPI (net)", irr: "IRR (net)",
      updatesHeading: "News from the portfolio", outlookHeading: "What comes next",
      portfolioHeading: (unit) => `Investments (${unit})`,
      portfolioColumns: ["Startup", "Ctry", "Field", "Invested", "Realized", "Unrealized", "Total value", "Multiple"],
      totalRow: "All investments",
      operatingHeading: (unit) => `Startup metrics, LTM (${unit})`,
    },
  },
];

export function profileById(id: string): GpProfile {
  const profile = PROFILES.find((p) => p.id === id);
  if (!profile) throw new Error(`unknown profile ${id}`);
  return profile;
}

export function profileByFundName(fundName: string): GpProfile {
  const profile = PROFILES.find((p) => p.fund_name === fundName);
  if (!profile) throw new Error(`unknown fund ${fundName}`);
  return profile;
}
