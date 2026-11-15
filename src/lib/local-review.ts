// The review on the public site (SPEC-public-release W2, ADR-0006): a visitor's decisions on the recorded queue run the
// server's own code (handleReview, decide, buildReviewState, postStoredRun, buildRecord) against in-memory stores that
// mirror the three SQL functions (core/snapshot.ts). Nothing leaves the browser; a reload starts from the snapshot again.
import { toPostingView, type RunView } from "../../core/pipeline/run-view.ts";
import { postStoredRun } from "../../core/posting/load.ts";
import { PortfolioError, type PortfolioSystem, type PostingLog } from "../../core/posting/post.ts";
import { groupRecords, toPortfolioRow, type PortfolioGroup, type PortfolioRecordView, type PortfolioRow } from "../../core/posting/portfolio-view.ts";
import { err, ok, type Result } from "../../core/result.ts";
import { handleReview, type ReviewApiResult } from "../../core/review/api.ts";
import { queueCounts } from "../../core/review/queue.ts";
import { buildReviewState } from "../../core/review/state.ts";
import {
  applyReviewDecision, completePosting, portfolioPost, toStoredPosting, toStoredRun, type LocalRun, type PortfolioEntry,
} from "../../core/snapshot.ts";
import { isJson } from "./json-response.ts";

const runs = new Map<string, LocalRun>(); // queued runs, loaded on first use, changed by decisions
const loading = new Map<string, Promise<void>>(); // one load per run, however many requests wait for it
let entries: PortfolioEntry[] | null = null; // the portfolio system's records (key columns and figures hash)
const postedRows: PortfolioRow[] = []; // records posted in this tab, as the portfolio page shows them

export function resetLocalReview() {
  runs.clear();
  loading.clear();
  entries = null;
  postedRows.length = 0;
}

async function snapshotJson<T>(file: string): Promise<T | null> {
  const response = await fetch(`/snapshot/${file}`);
  return response.ok && isJson(response) ? (await response.json()) as T : null;
}

async function localRun(runId: string): Promise<LocalRun | null> {
  const known = runs.get(runId);
  if (known) return known;
  let load = loading.get(runId);
  if (!load) {
    load = snapshotJson<LocalRun>(`local-runs/${runId}.json`).then((loaded) => {
      if (loaded && !runs.has(runId)) runs.set(runId, loaded); // never over a decision applied while this load ran
    });
    loading.set(runId, load);
  }
  await load;
  return runs.get(runId) ?? null;
}

const now = () => new Date().toISOString();

const system: PortfolioSystem = {
  async post(record, runId) {
    const local = runs.get(runId);
    entries ??= await snapshotJson<PortfolioEntry[]>("portfolio-records.json");
    if (!entries) throw new PortfolioError("unavailable", "the portfolio system's records could not be read");
    const { result, records } = portfolioPost(entries, new Set(local?.knownFunds.map((f) => f.id)), runId, record);
    entries = records;
    if (result.kind === "posted") {
      postedRows.push(toPortfolioRow({ fund_id: record.fund_id, period_end: record.period_end, version: result.version,
        posted_at: now(), source_run: runId }, record));
    }
    return result;
  },
};

const log: PostingLog = {
  async complete(runId, attempt, setPosted) {
    const local = runs.get(runId);
    if (local) runs.set(runId, completePosting(local, attempt, setPosted, now()));
  },
};

const post = (runId: string) => postStoredRun({
  load: async (id) => { const local = await localRun(id); return local ? toStoredPosting(local) : null; }, system, log,
}, runId);

export function reviewLocally(runId: string, body: unknown): Promise<ReviewApiResult> {
  return handleReview({
    async load(id) { const local = await localRun(id); return local ? buildReviewState(toStoredRun(local)) : null; },
    async apply(id, seenStatus, outcome): Promise<Result<string>> {
      await localRun(id);
      const local = runs.get(id); // read and write with no await between: two decisions in flight must not overwrite each other
      if (!local) return err("not_found", "Run not found.");
      const applied = applyReviewDecision(local, seenStatus, outcome, now());
      if (!applied.ok) return applied;
      runs.set(id, applied.value);
      return ok(applied.value.run.status);
    },
    async afterApproval(id) { return (await post(id)).ok ? "posted" : "approved"; },
  }, runId, body);
}

export const retryLocally = post;

// The recorded view of a run, with what this tab's decisions changed: status, decisions, the analyst's correction
// round, and the posting.
export function overlayRun(view: RunView): RunView {
  const local = runs.get(view.run.id);
  if (!local) return view;
  const created = entries?.some((e) => e.source_run === local.run.id) ?? false;
  return {
    ...view,
    run: { ...view.run, status: local.run.status as RunView["run"]["status"] },
    decisions: local.decisions,
    extraction: view.extraction && local.latest.round !== view.extraction.round
      ? { ...view.extraction, ...local.latest } : view.extraction,
    posting: toPostingView(local.postings, local.decisions, local.assessment?.policy ?? "unknown", created),
  };
}

// The queue as core/review/queue.ts would build it now: changed statuses, and runs no longer waiting removed.
type Waiting = "needs_review" | "needs_triage";
export function overlayQueue<I extends { run_id: string; status: Waiting }>(queue: { items: I[] }): { items: I[]; counts: Record<Waiting, number> } {
  const items = queue.items
    .map((item) => ({ ...item, status: (runs.get(item.run_id)?.run.status ?? item.status) as Waiting }))
    .filter((item) => item.status === "needs_review" || item.status === "needs_triage");
  return { items, counts: queueCounts(items) };
}

// The portfolio with this tab's postings added, grouped as the API groups it: by fund id, since a report may spell the
// fund by an alias. The rows carry no GP (it is on the group).
type ShownRecord = Omit<PortfolioRecordView, "gp_name">;
export function overlayPortfolio(groups: { gp_name: string; history: ShownRecord[] }[]): PortfolioGroup[] | typeof groups {
  if (postedRows.length === 0) return groups;
  const rows = groups.flatMap((g) => g.history.map((r) => ({ ...r, gp_name: g.gp_name }))); // groupRecords recomputes superseded
  return groupRecords([...rows, ...postedRows]);
}
