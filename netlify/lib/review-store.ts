import type { SupabaseClient } from "@supabase/supabase-js";
import { toDecisionCall, type ReviewOutcome, type ReviewState } from "../../core/review/actions.ts";
import type { QueueRow } from "../../core/review/queue.ts";
import { buildReviewState, type StoredRun } from "../../core/review/state.ts";
import type { KnownFund } from "../../core/pipeline/classify.ts";
import { err, ok, type Result } from "../../core/result.ts";

// Step-9 persistence: one atomic database call per decision (supabase/migrations/20261011112205_review.sql).
export function createSupabaseReviewStore(db: SupabaseClient) {
  // What the run stored, before the step-9 rules read it (also exported for the review in the browser, ADR-0006).
  async function loadStored(runId: string, knownFunds: KnownFund[]): Promise<StoredRun | null> {
    const { data: run, error } = await db.from("pipeline_runs").select("id, status").eq("id", runId).maybeSingle();
    if (error) throw new Error(`read run: ${error.message}`);
    if (!run) return null;
    const [events, latest, assessment, decisions] = await Promise.all([
      db.from("audit_events").select("event, payload").eq("run_id", runId).in("event", ["classify.completed", "parse.completed"]),
      db.from("extractions").select("raw, extraction, checks").eq("run_id", runId).order("round", { ascending: false }).limit(1).maybeSingle(),
      db.from("assessments").select("policy, fields").eq("run_id", runId).order("id", { ascending: false }).limit(1).maybeSingle(),
      db.from("review_decisions").select("kind, field, after").eq("run_id", runId).order("id"),
    ]);
    for (const r of [events, latest, assessment, decisions]) if (r.error) throw new Error(`load review state: ${r.error.message}`);
    if (!latest.data) return null; // nothing extracted: nothing to review
    const payload = (name: string) => (events.data?.find((e) => e.event === name)?.payload ?? {}) as Record<string, unknown>;
    return {
      run, classify: payload("classify.completed"), pageCount: Number(payload("parse.completed").pages ?? 1),
      latest: latest.data, assessment: assessment.data, decisions: decisions.data ?? [], knownFunds,
    };
  }

  return {
    async apply(runId: string, seenStatus: string, outcome: ReviewOutcome): Promise<Result<string>> {
      const { data, error } = await db.rpc("apply_review_decision", toDecisionCall(runId, seenStatus, outcome));
      if (!error) return ok(String(data));
      // 40001: the run changed since the analyst loaded it; 23514: a transition or reason rule refused it.
      if (error.code === "40001" || error.code === "23514") return err("conflict", error.message);
      throw new Error(`apply review decision: ${error.message}`);
    },
    // Everything step-9 rules need about one run, from what the pipeline and earlier decisions stored.
    async load(runId: string, knownFunds: KnownFund[]): Promise<ReviewState | null> {
      const stored = await loadStored(runId, knownFunds);
      return stored ? buildReviewState(stored) : null;
    },
    loadStored,
    // The newest runs with what the queue shows (core/review/queue.ts keeps the latest per document, if waiting).
    async queueRows(): Promise<QueueRow[]> {
      const { data, error } = await db.from("pipeline_runs")
        .select("id, document_id, status, created_at, documents(filename), assessments(reasons, id), extractions(extraction, round)")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(`read queue: ${error.message}`);
      return data.map((r) => {
        const latestOf = <T extends { id?: number; round?: number }>(rows: T[] | null, key: "id" | "round") =>
          [...(rows ?? [])].sort((a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0))[0];
        const assessment = latestOf(r.assessments as { reasons: string[]; id: number }[], "id");
        const extraction = latestOf(r.extractions as { extraction: { classification?: { fund_name?: string; period_end?: string } } | null; round: number }[], "round");
        return {
          run_id: r.id, document_id: r.document_id, status: r.status, created_at: r.created_at,
          filename: (r.documents as unknown as { filename: string } | null)?.filename ?? "",
          fund_name: extraction?.extraction?.classification?.fund_name ?? null,
          period_end: extraction?.extraction?.classification?.period_end ?? null,
          reasons: assessment?.reasons ?? [],
        };
      });
    },
    async decisions(runId: string) {
      const { data, error } = await db.from("review_decisions")
        .select("kind, field, before, after, reason, analyst, policy, created_at").eq("run_id", runId).order("id");
      if (error) throw new Error(`read review decisions: ${error.message}`);
      return data;
    },
  };
}
