import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoredPosting } from "../../core/posting/load.ts";
import type { RecordDecision } from "../../core/posting/record.ts";
import { Extraction } from "../../core/schema.ts";
import { createSupabaseKnownFundRegistry } from "./run-store.ts";

// What posting needs about one run, from what the pipeline and the review stored.
export function createSupabasePostingLoader(db: SupabaseClient) {
  return async (runId: string): Promise<StoredPosting | null> => {
    const { data: run, error } = await db.from("pipeline_runs").select("id, status, pipeline_version, documents(sha256)").eq("id", runId).maybeSingle();
    if (error) throw new Error(`read run: ${error.message}`);
    if (!run) return null;
    const [classify, latest, assessment, decisions, knownFunds] = await Promise.all([
      db.from("audit_events").select("payload").eq("run_id", runId).eq("event", "classify.completed").limit(1).maybeSingle(),
      db.from("extractions").select("extraction").eq("run_id", runId).order("round", { ascending: false }).limit(1).maybeSingle(),
      db.from("assessments").select("policy").eq("run_id", runId).order("id", { ascending: false }).limit(1).maybeSingle(),
      db.from("review_decisions").select("kind, field, before, after, analyst, reason").eq("run_id", runId).order("id"),
      createSupabaseKnownFundRegistry(db).list(),
    ]);
    for (const r of [classify, latest, assessment, decisions]) if (r.error) throw new Error(`load posting: ${r.error.message}`);
    const extraction = Extraction.safeParse(latest.data?.extraction);
    if (!extraction.success) return null; // nothing valid was extracted: nothing to post
    return {
      run: { id: run.id, status: run.status, pipeline_version: run.pipeline_version },
      documentSha256: (run.documents as unknown as { sha256: string }).sha256,
      classify: (classify.data?.payload ?? {}) as Record<string, unknown>,
      extraction: extraction.data, policy: assessment.data?.policy ?? "none",
      decisions: (decisions.data ?? []) as RecordDecision[], knownFunds,
    };
  };
}
