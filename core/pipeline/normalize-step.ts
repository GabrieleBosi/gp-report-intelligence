// Step 5 (normalize + rules). Code turns printed strings into schema v1 values and runs the financial identity
// checks. Nothing is guessed: an unreadable or untraceable figure becomes null plus a recorded issue, which step 7
// treats as low confidence. The result is stored as round 0 (the critic adds rounds 1-2).
import { runIdentityChecks, type CheckResult } from "../checks/identities.ts";
import { Extraction, type Money, type PortfolioCompany, type Ratio } from "../schema.ts";
import type { Result } from "../result.ts";
import { detectSeparators, normalizeAmount, normalizePercent, normalizeRatio, scaleFromUnitStatement, type Separators } from "./normalize.ts";
import type { RawExtraction, RawValue } from "./prompts/extract.ts";
import type { Classification } from "./classify.ts";
import type { Step } from "./run.ts";

export type NormalizationIssue = { field: string; raw: string | null; reason: string };
export type ExtractionRow = { run_id: string; round: number; raw: RawExtraction; extraction: Extraction | null; checks: CheckResult[] };
export interface ExtractionStore { append(row: ExtractionRow): Promise<void> }

const companyKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The document's number style, read from all its printed amounts (also used to normalize the step-7 read B).
export function documentSeparators(raw: RawExtraction): Result<Separators> {
  const amounts = [
    ...Object.entries(raw.fund).filter(([k]) => !["tvpi", "dpi", "rvpi", "net_irr"].includes(k)).map(([, value]) => value),
    ...raw.portfolio.companies.flatMap((co) => [co.invested, co.realized, co.unrealized, co.total_value]),
    ...raw.operating.companies.flatMap((co) => [co.revenue_ltm, co.ebitda_ltm, co.net_debt]),
  ].flatMap((value) => (value.raw ? [value.raw] : []));
  return detectSeparators(amounts);
}

// `raw` is the extraction actually normalized (blank rows dropped): callers continue from it, so every later index
// (checks, critic slots, read-B comparison, assessment) refers to the same list of companies.
export type Normalized = { raw: RawExtraction; extraction: Extraction | null; checks: CheckResult[]; issues: NormalizationIssue[] };

// The operating-metrics row of a company, joined by name. Shared by step 5 and the critic so both read the same row;
// with duplicates, the first row wins (and normalizeRaw records an issue).
export function operatingRow(raw: RawExtraction, name: string): RawExtraction["operating"]["companies"][number] | undefined {
  return raw.operating.companies.find((o) => companyKey(o.name) === companyKey(name));
}

// The pure part of step 5, shared with the critic (step 6), which re-normalizes after each correction round.
export function normalizeRaw(extracted: RawExtraction, c: Classification): Normalized {
  const issues: NormalizationIssue[] = [];
  // A row with no name and no figures is not a company (models sometimes emit one when they miss the table). Dropped
  // with an issue; the NAV bridge then fails on an empty portfolio and the critic re-reads it.
  const blank = (co: RawExtraction["portfolio"]["companies"][number]) => !co.name.trim()
    && [co.invested, co.realized, co.unrealized, co.total_value, co.gross_moic].every((f) => f.raw === null);
  const blanks = extracted.portfolio.companies.filter(blank).length;
  if (blanks > 0) {
    issues.push({ field: "portfolio_companies", raw: null, reason: `${blanks} blank row${blanks > 1 ? "s" : ""} ignored (no name, no figures)` });
  }
  const raw: RawExtraction = { ...extracted, portfolio: { companies: extracted.portfolio.companies.filter((co) => !blank(co)) } };
  const firstName = new Map<string, string>();
  for (const o of raw.operating.companies) {
    const name = firstName.get(companyKey(o.name));
    if (name) issues.push({ field: "operating", raw: o.name, reason: `${name} appears more than once in the operating metrics table; the first row is used` });
    else firstName.set(companyKey(o.name), o.name);
  }
  let extraction: Extraction | null = null;
  if (!c.gp_name || !c.fund_name || !c.period_end || !c.currency) {
    issues.push({ field: "classification", raw: null, reason: `classification incomplete: missing ${c.missing.join(", ")}` });
  } else {
    const scale = scaleFromUnitStatement(c.unit_statement);
    const separators = documentSeparators(raw);
    if (!scale.ok) issues.push({ field: "unit_statement", raw: c.unit_statement, reason: scale.error.message });
    if (!separators.ok) issues.push({ field: "number_format", raw: null, reason: separators.error.message });

    if (scale.ok && separators.ok) {
      const candidate = build(raw, c.currency, scale.value, separators.value, issues, {
        gp_name: c.gp_name, fund_name: c.fund_name, period_end: c.period_end, report_type: c.report_type, currency: c.currency,
      });
      extraction = validateFieldByField(candidate, raw, issues);
    }
  }
  // Previous posted quarter arrives with the posting module; until then quarter-on-quarter checks are skipped.
  const checks = extraction ? runIdentityChecks(extraction, null) : [];
  return { raw, extraction, checks, issues };
}

export function normalizeStep(store: ExtractionStore): Step {
  return {
    name: "normalize",
    async run(ctx) {
      if (!ctx.raw || !ctx.classification) throw new Error("nothing to normalize (classify and extract must run first)");
      const { raw, extraction, checks, issues } = normalizeRaw(ctx.raw, ctx.classification);
      await store.append({ run_id: ctx.runId, round: 0, raw, extraction, checks });

      const failed = checks.filter((check) => check.status === "fail").map((check) => check.id);
      return {
        ctx: { ...ctx, raw, extraction, checks, normalizationIssues: issues, extractionRound: 0 },
        summary: {
          extraction: extraction ? "valid" : "none", issues: issues.length,
          checksPassed: checks.filter((check) => check.status === "pass").length, checksFailed: failed,
          ...(issues.length ? { firstIssue: `${issues[0]?.field}: ${issues[0]?.reason}` } : {}),
        },
      };
    },
  };
}

// One invalid figure (e.g. a negative commitment) must not discard every other value: blank the offending field,
// record why, and validate again. Only a failure outside the figures (the classification block) drops the extraction.
function validateFieldByField(candidate: Extraction, raw: RawExtraction, issues: NormalizationIssue[]): Extraction | null {
  for (let attempt = 0; attempt < 3; attempt++) {
    const parsed = Extraction.safeParse(candidate);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) {
      const [section, indexOrField, companyField] = issue.path;
      if (section === "fund" && typeof indexOrField === "string") {
        const key = indexOrField as keyof Extraction["fund"];
        candidate.fund[key] = null;
        issues.push({ field: `fund.${key}`, raw: raw.fund[key]?.raw ?? null, reason: issue.message });
      } else if (section === "portfolio_companies" && typeof indexOrField === "number" && typeof companyField === "string") {
        const company = candidate.portfolio_companies[indexOrField] as Record<string, unknown> | undefined;
        if (company) company[companyField] = null;
        const printed = (raw.portfolio.companies[indexOrField] as Record<string, unknown> | undefined)?.[companyField];
        issues.push({ field: `portfolio_companies[${indexOrField}].${companyField}`,
          raw: (printed as RawValue | undefined)?.raw ?? null, reason: issue.message });
      } else {
        // Defensive: classification is validated before this step, so this is not expected to happen.
        issues.push({ field: issue.path.join("."), raw: null, reason: issue.message });
        return null;
      }
    }
  }
  return null;
}

function build(raw: RawExtraction, currency: string, scale: number, separators: Separators, issues: NormalizationIssue[],
  classification: Extraction["classification"]): Extraction {
  // A figure is kept only if it was read AND can be traced to a page; otherwise null plus an issue.
  function read<T extends number | null>(field: string, value: RawValue, parse: (r: string) => Result<T>): { value: number; page: number } | null {
    if (value.raw === null) return null; // not stated: a valid answer, not an issue
    const parsed = parse(value.raw);
    if (!parsed.ok) { issues.push({ field, raw: value.raw, reason: parsed.error.message }); return null; }
    if (parsed.value === null) return null;
    if (value.page === null || value.page < 1) { issues.push({ field, raw: value.raw, reason: "no page reference" }); return null; }
    return { value: parsed.value, page: value.page };
  }
  const money = (field: string, value: RawValue): Money | null => {
    const r = read(field, value, (s) => normalizeAmount(s, scale, separators));
    return r && { value: r.value, currency, source: { page: r.page } };
  };
  const ratio = (field: string, value: RawValue, percent = false): Ratio | null => {
    const r = read(field, value, percent ? normalizePercent : normalizeRatio);
    return r && { value: r.value, source: { page: r.page } };
  };

  const f = raw.fund;
  const companies: PortfolioCompany[] = raw.portfolio.companies.map((co, i) => {
    const at = `portfolio_companies[${i}]`;
    const ops = operatingRow(raw, co.name);
    const none = { raw: null, page: null };
    return {
      name: co.name, sector: co.sector, country: co.country,
      investment_date: co.investment_date && /^\d{4}-\d{2}-\d{2}$/.test(co.investment_date) ? co.investment_date : null,
      invested: money(`${at}.invested`, co.invested), realized: money(`${at}.realized`, co.realized),
      unrealized: money(`${at}.unrealized`, co.unrealized), total_value: money(`${at}.total_value`, co.total_value),
      gross_moic: ratio(`${at}.gross_moic`, co.gross_moic),
      revenue_ltm: money(`${at}.revenue_ltm`, ops?.revenue_ltm ?? none), ebitda_ltm: money(`${at}.ebitda_ltm`, ops?.ebitda_ltm ?? none),
      net_debt: money(`${at}.net_debt`, ops?.net_debt ?? none),
    };
  });

  return {
    classification,
    fund: {
      commitment: money("fund.commitment", f.commitment), paid_in: money("fund.paid_in", f.paid_in),
      unfunded: money("fund.unfunded", f.unfunded), distributions: money("fund.distributions", f.distributions),
      nav: money("fund.nav", f.nav), tvpi: ratio("fund.tvpi", f.tvpi), dpi: ratio("fund.dpi", f.dpi),
      rvpi: ratio("fund.rvpi", f.rvpi), net_irr: ratio("fund.net_irr", f.net_irr, true),
    },
    portfolio_companies: companies,
    qualitative: {
      key_updates: raw.qualitative.key_updates.map((u) => u.trim()).filter(Boolean),
      outlook: raw.qualitative.outlook?.trim() || null,
    },
  };
}
