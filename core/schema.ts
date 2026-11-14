// Canonical extraction schema v1: the single contract shared by corpus labels, LLM output parsing (step 4),
// the financial checks (step 5), confidence (step 7) and evals. JSON fields are snake_case, matching the DB columns.
import { z } from "zod";

export const SCHEMA_VERSION = "v1";

const Currency = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. EUR");

// Where a value was read from. `bbox` is optional: [x0, y0, x1, y1] as fractions of the page.
export const Source = z.object({
  page: z.number().int().min(1),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

// Monetary amounts are normalized to full units: "USD 12.5m" -> 12_500_000, "(1.2)" -> -1_200_000.
export const Money = z.object({ value: z.number().finite(), currency: Currency, source: Source });
const NonNegativeMoney = Money.extend({ value: z.number().finite().min(0) });

// Ratios as plain numbers: TVPI 1.4x -> 1.4, IRR 14.2% -> 0.142.
export const Ratio = z.object({ value: z.number().finite(), source: Source });
const NonNegativeRatio = Ratio.extend({ value: z.number().finite().min(0) });

export const Classification = z.object({
  gp_name: z.string().min(1),
  fund_name: z.string().min(1),
  period_end: z.iso.date(),
  report_type: z.enum(["quarterly_report", "capital_account_statement", "other"]),
  currency: Currency,
});

// Every figure is nullable: "the report does not state it" is a valid extraction, not a failure.
export const FundFigures = z.object({
  commitment: NonNegativeMoney.nullable(),
  paid_in: NonNegativeMoney.nullable(),
  unfunded: Money.nullable(),
  distributions: NonNegativeMoney.nullable(),
  nav: NonNegativeMoney.nullable(),
  tvpi: NonNegativeRatio.nullable(),
  dpi: NonNegativeRatio.nullable(),
  rvpi: NonNegativeRatio.nullable(),
  net_irr: Ratio.nullable(),
});

export const PortfolioCompany = z.object({
  name: z.string().min(1),
  sector: z.string().nullable(),
  country: z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2").nullable(),
  investment_date: z.iso.date().nullable(),
  invested: NonNegativeMoney.nullable(),
  realized: NonNegativeMoney.nullable(),
  unrealized: NonNegativeMoney.nullable(),
  total_value: NonNegativeMoney.nullable(),
  gross_moic: NonNegativeRatio.nullable(),
  revenue_ltm: NonNegativeMoney.nullable(),
  ebitda_ltm: Money.nullable(),
  net_debt: Money.nullable(),
});

export const Qualitative = z.object({
  key_updates: z.array(z.string().min(1)),
  outlook: z.string().nullable(),
});

export const Extraction = z.object({
  classification: Classification,
  fund: FundFigures,
  portfolio_companies: z.array(PortfolioCompany),
  qualitative: Qualitative,
});

// Figures that get the independent vision read in step 7. Each company's total_value is a key figure too.
export const FUND_KEY_FIGURES = ["commitment", "paid_in", "distributions", "nav", "tvpi", "dpi"] as const;
export const COMPANY_KEY_FIGURES = ["total_value"] as const;

export const Route = z.enum(["auto_post", "review", "triage"]);

// Golden label for one corpus document. `expected` holds values AS PRINTED (normalized to full units);
// catching inconsistencies is the checks' job, recorded in `expected_flags`.
export const CorpusLabel = z.object({
  doc_id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case"),
  file: z.string().startsWith("corpus/docs/"),
  split: z.enum(["dev", "heldout"]),
  format: z.enum(["native_pdf", "scanned_pdf", "xlsx"]),
  expected: Extraction,
  expected_flags: z.array(z.string().regex(/^[a-z0-9_]+$/)),
  expected_route: Route,
  // Deliberately flawed documents (SPEC-corpus "Traps"); kept out of quarter-on-quarter comparisons.
  trap: z.enum(["tvpi_misprint", "chart_nav", "restatement"]).optional(),
});

export type Source = z.infer<typeof Source>;
export type Money = z.infer<typeof Money>;
export type Ratio = z.infer<typeof Ratio>;
export type Classification = z.infer<typeof Classification>;
export type FundFigures = z.infer<typeof FundFigures>;
export type PortfolioCompany = z.infer<typeof PortfolioCompany>;
export type Extraction = z.infer<typeof Extraction>;
export type Route = z.infer<typeof Route>;
export type CorpusLabel = z.infer<typeof CorpusLabel>;
