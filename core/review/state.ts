// Rebuilds what step-9 rules need (ReviewState) from what the run stored: the classify step's audit summary, the
// latest extraction round, the assessment and earlier decisions. Pure, so the API can be tested without a database.
import type { CheckResult } from "../checks/identities.ts";
import type { Classification, KnownFund } from "../pipeline/classify.ts";
import type { RawExtraction } from "../pipeline/prompts/extract.ts";
import type { Extraction } from "../schema.ts";
import type { ReviewState } from "./actions.ts";

export type StoredRun = {
  run: { id: string; status: string };
  classify: Record<string, unknown>; // the classify step's audit summary
  pageCount: number;
  latest: { raw: RawExtraction; extraction: Extraction | null; checks: CheckResult[] };
  assessment: { policy: string; fields: { path: string; label: string; level: string }[] } | null;
  decisions: { kind: string; field: string | null; after?: { raw?: string | null } | null }[];
  knownFunds: KnownFund[];
};

const str = (v: unknown) => (typeof v === "string" ? v : null);

export function buildReviewState(s: StoredRun): ReviewState {
  const c = s.classify;
  const stored = s.latest.extraction?.classification;
  const assigned = [...s.decisions].reverse().find((d) => d.kind === "fund_assigned");
  const fund = assigned ? s.knownFunds.find((f) => f.fund_name === assigned.after?.raw) : undefined;
  const classification: Classification = {
    gp_name: fund?.gp_name ?? stored?.gp_name ?? str(c.gp_name),
    fund_name: fund?.fund_name ?? stored?.fund_name ?? str(c.fund_name),
    period_end: stored?.period_end ?? str(c.period_end),
    report_type: stored?.report_type ?? (str(c.report_type) as Classification["report_type"] | null) ?? "quarterly_report",
    currency: stored?.currency ?? str(c.currency),
    unit_statement: str(c.unit_statement),
    evidence_page: typeof c.evidence_page === "number" ? c.evidence_page : 1, // older runs did not record it
    gp_status: fund ? "known" : c.gp_status === "known" ? "known" : "unknown",
    known_fund_id: fund?.id ?? str(c.known_fund_id),
    missing: fund ? [] : Array.isArray(c.missing) ? (c.missing as Classification["missing"]) : [],
  };
  const reviewed = new Set(s.decisions.filter((d) => d.kind === "field_accepted" || d.kind === "field_corrected").map((d) => d.field));
  return {
    status: s.run.status, raw: s.latest.raw, classification, checks: s.latest.checks, pageCount: s.pageCount,
    policy: s.assessment?.policy ?? "none",
    pendingKeyFigures: (s.assessment?.fields ?? []).filter((f) => f.level !== "high" && !reviewed.has(f.path)).map(({ path, label }) => ({ path, label })),
    knownFunds: s.knownFunds,
  };
}
