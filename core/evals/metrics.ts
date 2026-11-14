// Grading by code against the label (SPEC-evals decision 1): every target is a number or a label, so comparison is
// exact and free. Companies are matched by name, so a missing company counts as wrong, not as shifted rows.
import { FUND_KEY_FIGURES, type Extraction, type PortfolioCompany } from "../schema.ts";

export type FieldDiff = { path: string; label: string; expected: number | null; actual: number | null };
export type Tally = { total: number; correct: number; wrong: FieldDiff[] };
export type DocumentScore = {
  keyFigures: Tally; allFigures: Tally; classificationOk: boolean; classificationDiffs: string[]; routeOk: boolean; unsafe: boolean;
};
export type Summary = { documents: number; unsafe: number; keyFigureAccuracy: number; allFigureAccuracy: number;
  classificationAccuracy: number; routeAccuracy: number };

const FUND_FIELDS = ["commitment", "paid_in", "unfunded", "distributions", "nav", "tvpi", "dpi", "rvpi", "net_irr"] as const;
const COMPANY_FIELDS = ["invested", "realized", "unrealized", "total_value", "gross_moic", "revenue_ltm", "ebitda_ltm", "net_debt"] as const;
const CLASSIFICATION = ["gp_name", "fund_name", "period_end", "report_type", "currency"] as const;
const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const same = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)));

export function compareDocument(expected: Extraction, actual: Extraction | null, route: string | null, expectedRoute: string): DocumentScore {
  const key: Tally = { total: 0, correct: 0, wrong: [] };
  const all: Tally = { total: 0, correct: 0, wrong: [] };
  const score = (path: string, label: string, e: number | null, a: number | null, isKey: boolean) => {
    for (const t of isKey ? [key, all] : [all]) {
      t.total++;
      if (same(a, e)) t.correct++; else t.wrong.push({ path, label, expected: e, actual: a });
    }
  };
  for (const f of FUND_FIELDS) {
    score(`fund.${f}`, f, expected.fund[f]?.value ?? null, actual?.fund[f]?.value ?? null, (FUND_KEY_FIGURES as readonly string[]).includes(f));
  }
  expected.portfolio_companies.forEach((company, i) => {
    const found: PortfolioCompany | undefined = actual?.portfolio_companies.find((c) => nameKey(c.name) === nameKey(company.name));
    for (const f of COMPANY_FIELDS) {
      score(`portfolio_companies[${i}].${f}`, `${company.name}: ${f}`, company[f]?.value ?? null, found?.[f]?.value ?? null, f === "total_value");
    }
  });
  const classificationDiffs = actual ? CLASSIFICATION.filter((k) => actual.classification[k] !== expected.classification[k]) : [...CLASSIFICATION];
  return {
    keyFigures: key, allFigures: all, classificationOk: classificationDiffs.length === 0, classificationDiffs,
    routeOk: route === expectedRoute, unsafe: route === "auto_post" && key.wrong.length > 0,
  };
}

export function summarize(scores: DocumentScore[]): Summary {
  const ratio = (n: number, d: number) => (d === 0 ? 1 : n / d);
  const sum = (f: (s: DocumentScore) => number) => scores.reduce((t, s) => t + f(s), 0);
  return {
    documents: scores.length, unsafe: scores.filter((s) => s.unsafe).length,
    keyFigureAccuracy: ratio(sum((s) => s.keyFigures.correct), sum((s) => s.keyFigures.total)),
    allFigureAccuracy: ratio(sum((s) => s.allFigures.correct), sum((s) => s.allFigures.total)),
    classificationAccuracy: ratio(scores.filter((s) => s.classificationOk).length, scores.length),
    routeAccuracy: ratio(scores.filter((s) => s.routeOk).length, scores.length),
  };
}
