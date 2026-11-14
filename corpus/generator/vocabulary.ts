// How each GP words its report. Different GPs name the same figure differently ("Paid-in capital", "Contributed
// Capital", "Called capital"): the extraction prompts must map them all to one schema field. Defaults are the
// Alpenrose wording, so documents generated before this module stay byte-identical.
export type ReportVocabulary = {
  titleSuffix: string;
  reportingLine: (date: string, unit: string) => string;
  fundHeading: string;
  commitment: string; paidIn: string; unfunded: string; distributions: string; nav: string;
  performanceHeading: string;
  tvpi: string; dpi: string; rvpi: string; irr: string;
  updatesHeading: string; outlookHeading: string;
  portfolioHeading: (unit: string) => string;
  portfolioColumns: [string, string, string, string, string, string, string, string];
  totalRow: string;
  operatingHeading: (unit: string) => string;
};

export const DEFAULT_VOCABULARY: ReportVocabulary = {
  titleSuffix: "Quarterly Report",
  reportingLine: (date, unit) => `Reporting date: ${date} - all amounts in ${unit} unless stated otherwise`,
  fundHeading: "Fund overview",
  commitment: "Total commitments", paidIn: "Paid-in capital", unfunded: "Unfunded commitments",
  distributions: "Cumulative distributions", nav: "Net asset value",
  performanceHeading: "Performance (net to limited partners)",
  tvpi: "TVPI", dpi: "DPI", rvpi: "RVPI", irr: "Net IRR since inception",
  updatesHeading: "Key developments in the quarter", outlookHeading: "Outlook",
  portfolioHeading: (unit) => `Portfolio overview (${unit})`,
  portfolioColumns: ["Company", "Ctry", "Sector", "Invested", "Realized", "Unrealized", "Total value", "Gross MOIC"],
  totalRow: "Total portfolio",
  operatingHeading: (unit) => `Operating metrics, last twelve months (${unit})`,
};
