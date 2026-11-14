// What the public snapshot contains (SPEC-public-release W2, ADR-0006), and the in-memory stores the review in the
// browser runs against: pure, used by scripts/snapshot.ts and src/lib/local-review.ts.
import type { KnownFund } from "./pipeline/classify.ts";
import type { DecisionView, PostingView } from "./pipeline/run-view.ts";
import { groupRecords, type PortfolioGroup } from "./posting/portfolio-view.ts";
import type { StoredPosting } from "./posting/load.ts";
import { PortfolioError, type PostingAttempt, type PostResult } from "./posting/post.ts";
import type { PortfolioRecord } from "./posting/record.ts";
import { err, ok, type Result } from "./result.ts";
import type { ReviewOutcome } from "./review/actions.ts";
import type { StoredRun } from "./review/state.ts";
import { Extraction } from "./schema.ts";
import type { MetricRows } from "./showcase/metrics.ts";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

// Every id an exported response mentions, at any depth: the export follows them until no new run turns up, so no link
// on the public site can point at a run that is not in the snapshot.
export function uuidsIn(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") for (const id of v.match(UUID) ?? []) found.add(id);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return [...found];
}

// The metric rows with the keys needed to tell which document each row belongs to.
export type ExportRows = {
  documents: (MetricRows["documents"][number] & { id: string })[];
  pipeline_runs: (MetricRows["pipeline_runs"][number] & { document_id: string })[];
  assessments: MetricRows["assessments"];
  review_decisions: (MetricRows["review_decisions"][number] & { run_id: string })[];
  postings: (MetricRows["postings"][number] & { run_id: string })[];
  portfolio_records: (MetricRows["portfolio_records"][number] & { source_run: string })[];
  usage_ledger: (MetricRows["usage_ledger"][number] & { run_id: string | null })[];
};

// The snapshot leaves out uploaded documents, so its metrics do too. Model spend that belongs to no run (evals and
// experiments on the corpus) stays.
export function corpusOnly(rows: ExportRows): ExportRows {
  const documents = rows.documents.filter((d) => d.source === "corpus");
  const docIds = new Set(documents.map((d) => d.id));
  const pipeline_runs = rows.pipeline_runs.filter((r) => docIds.has(r.document_id));
  const runIds = new Set(pipeline_runs.map((r) => r.id));
  return {
    documents, pipeline_runs,
    assessments: rows.assessments.filter((a) => runIds.has(a.run_id)),
    review_decisions: rows.review_decisions.filter((d) => runIds.has(d.run_id)),
    postings: rows.postings.filter((p) => runIds.has(p.run_id)),
    portfolio_records: rows.portfolio_records.filter((p) => runIds.has(p.source_run)),
    usage_ledger: rows.usage_ledger.filter((u) => u.run_id === null || runIds.has(u.run_id)),
  };
}

// The portfolio as the API groups it, without the versions posted from uploaded documents: the newest version left is
// current again. Without this the export would follow an upload's run and refuse it.
export function corpusPortfolio(groups: PortfolioGroup[], corpusRunIds: ReadonlySet<string>): PortfolioGroup[] {
  return groupRecords(groups.flatMap((g) => g.history).filter((r) => corpusRunIds.has(r.source_run))); // regroups superseded
}

// One queued run as the snapshot stores it: what the review store and the posting loader read from the database,
// merged. The browser derives both from it, so a decision and the posting after it see the same run.
export type LocalRun = {
  run: { id: string; status: string; pipeline_version: string };
  documentSha256: string;
  classify: Record<string, unknown>;
  pageCount: number;
  latest: StoredRun["latest"] & { round: number };
  assessment: StoredRun["assessment"];
  decisions: DecisionView[];
  knownFunds: KnownFund[];
  postings: PostingView["attempts"];
};

export function toStoredRun(l: LocalRun): StoredRun {
  return {
    run: { id: l.run.id, status: l.run.status }, classify: l.classify, pageCount: l.pageCount,
    latest: { raw: l.latest.raw, extraction: l.latest.extraction, checks: l.latest.checks }, assessment: l.assessment,
    decisions: l.decisions.map(({ kind, field, after }) => ({ kind, field, after: after as { raw?: string | null } | null })),
    knownFunds: l.knownFunds,
  };
}

// As netlify/lib/posting-store.ts: nothing valid extracted, nothing to post.
export function toStoredPosting(l: LocalRun): StoredPosting | null {
  const extraction = Extraction.safeParse(l.latest.extraction);
  if (!extraction.success) return null;
  return {
    run: l.run, documentSha256: l.documentSha256, classify: l.classify, extraction: extraction.data,
    policy: l.assessment?.policy ?? "none", knownFunds: l.knownFunds,
    decisions: l.decisions.map(({ kind, field, before, after, analyst, reason }) => ({ kind, field, before, after, analyst, reason })),
  };
}

// apply_review_decision (migration 20261011112205_review): refuse a stale view, append the decision, move the status,
// store a correction as a new analyst round after the critic's. The status-transition check (check_run_transition) and,
// below, complete_posting's guards are not mirrored: decide() and postRun, which run before these, enforce the same rules.
export function applyReviewDecision(l: LocalRun, seenStatus: string, outcome: ReviewOutcome, at: string): Result<LocalRun> {
  if (l.run.status !== seenStatus) return err("conflict", `run is ${l.run.status} now, not ${seenStatus}`);
  const c = outcome.correction;
  return ok({
    ...l,
    run: { ...l.run, status: outcome.nextStatus },
    decisions: [...l.decisions, { ...outcome.decision, created_at: at } as DecisionView],
    latest: c ? { round: Math.max(l.latest.round + 1, 3), raw: c.raw, extraction: c.extraction, checks: c.checks } : l.latest,
  });
}

export type PortfolioEntry = { fund_id: string; period_end: string; version: number; source_run: string; figures_hash: string };

// portfolio_post (migration 20261011121711_posting): idempotent per run, unchanged when the figures equal the current
// version's, otherwise the next version.
export function portfolioPost(records: PortfolioEntry[], knownFundIds: ReadonlySet<string>, runId: string,
  record: PortfolioRecord): { result: PostResult; records: PortfolioEntry[] } {
  if (!knownFundIds.has(record.fund_id)) throw new PortfolioError("rejected", `unknown fund ${record.fund_id}`);
  const recordId = `${record.fund_id}:${record.period_end}`;
  const existing = records.find((r) => r.source_run === runId);
  if (existing) return { result: { kind: "duplicate", recordId, version: existing.version, supersedes: null }, records };
  const current = records.filter((r) => r.fund_id === record.fund_id && r.period_end === record.period_end)
    .sort((a, b) => b.version - a.version)[0];
  if (current?.figures_hash === record.figures_hash) {
    return { result: { kind: "unchanged", recordId, version: current.version, supersedes: null }, records };
  }
  const version = (current?.version ?? 0) + 1;
  return {
    result: { kind: "posted", recordId, version, supersedes: version > 1 ? version - 1 : null },
    records: [...records, { fund_id: record.fund_id, period_end: record.period_end, version, source_run: runId, figures_hash: record.figures_hash }],
  };
}

// complete_posting (same migration): number the attempt, and mark the run posted when the attempt posted.
export function completePosting(l: LocalRun, attempt: PostingAttempt, setPosted: boolean, at: string): LocalRun {
  const { outcome, record_id, version, error } = attempt;
  return {
    ...l,
    run: setPosted ? { ...l.run, status: "posted" } : l.run,
    postings: [...l.postings, { attempt: l.postings.length + 1, outcome, record_id, version, error, created_at: at }],
  };
}
