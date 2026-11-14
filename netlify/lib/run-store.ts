import type { SupabaseClient } from "@supabase/supabase-js";
import { DocumentRecord, forPipeline } from "../../core/documents.ts";
import type { KnownFund, KnownFundRegistry } from "../../core/pipeline/classify.ts";
import { withRetry } from "../../core/retry.ts";
import type { AssessmentStore } from "../../core/pipeline/confidence-step.ts";
import type { DocumentLoader } from "../../core/pipeline/load.ts";
import type { ExtractionStore } from "../../core/pipeline/normalize-step.ts";
import type { RunStore } from "../../core/pipeline/run.ts";
import { AssessmentView, DecisionView, ExtractionView, PostingView, RunRecord, toRunView, type AuditRow, type RunView, toPostingView } from "../../core/pipeline/run-view.ts";
import { err, ok, type Result } from "../../core/result.ts";
import { STALE_AFTER_MINUTES } from "../../core/run-request.ts";
import { RAW_REPORTS_BUCKET } from "./supabase.ts";

const RUN_COLUMNS = "id, document_id, status, pipeline_version, error, created_at, started_at, finished_at";
const UNIQUE_VIOLATION = "23505";

export type SupabaseRunStore = RunStore & {
  create(documentId: string, pipelineVersion: string): Promise<Result<{ runId: string }>>;
  expireStale(documentId: string, now?: Date): Promise<number>;
  view(runId: string): Promise<RunView | null>;
};

export function createSupabaseRunStore(db: SupabaseClient): SupabaseRunStore {
  const fail = (what: string, error: { message: string }) => new Error(`${what}: ${error.message}`);
  return {
    async create(documentId, pipelineVersion) {
      const { data, error } = await db.from("pipeline_runs")
        .insert({ document_id: documentId, pipeline_version: pipelineVersion }).select("id").single();
      if (error?.code === UNIQUE_VIOLATION) return err("run_active", "This document already has a run in progress.");
      if (error) throw fail("create run", error);
      return ok({ runId: data.id as string });
    },
    // Both moves are allowed by the transition trigger (queued -> failed, running -> failed).
    async expireStale(documentId, now = new Date()) {
      const before = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
      const expire = async (status: "queued" | "running", column: "created_at" | "started_at", minutes: number) => {
        const { data, error } = await db.from("pipeline_runs").update({
          status: "failed", finished_at: now.toISOString(),
          error: `abandoned: still ${status} after ${minutes} minutes (the run's function never finished); expired when a new run was requested`,
        }).eq("document_id", documentId).eq("status", status).lt(column, before(minutes)).select("id");
        if (error) throw fail(`expire ${status} runs`, error);
        return data.length;
      };
      return (await expire("queued", "created_at", STALE_AFTER_MINUTES.queued))
        + (await expire("running", "started_at", STALE_AFTER_MINUTES.running));
    },
    // Exactly-once start: only a queued run can be claimed, so a repeated execute call finds nothing to do.
    async claim(runId) {
      const { data, error } = await db.from("pipeline_runs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", runId).eq("status", "queued").select("document_id").maybeSingle();
      if (error) throw fail("claim run", error);
      return data ? { documentId: data.document_id as string } : null;
    },
    async finish(runId, outcome) {
      const { error } = await db.from("pipeline_runs").update({
        status: outcome.status, finished_at: new Date().toISOString(), error: outcome.status === "failed" ? outcome.error : null,
      }).eq("id", runId);
      if (error) throw fail("finish run", error);
    },
    async appendAudit(event) {
      const { error } = await db.from("audit_events").insert(event);
      if (error) throw fail("append audit event", error);
    },
    async view(runId) {
      const { data: run, error } = await db.from("pipeline_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle();
      if (error) throw fail("read run", error);
      if (!run) return null;
      const { data: document, error: documentError } = await db.from("documents").select("filename").eq("id", run.document_id).single();
      if (documentError) throw fail("read run document", documentError);
      const { data: events, error: eventsError } = await db.from("audit_events")
        .select("step, actor, event, payload, created_at").eq("run_id", runId).order("id");
      if (eventsError) throw fail("read run events", eventsError);
      const { data: latest, error: extractionError } = await db.from("extractions").select("round, raw, extraction, checks")
        .eq("run_id", runId).order("round", { ascending: false }).limit(1).maybeSingle();
      if (extractionError) throw fail("read run extraction", extractionError);
      const { data: assessment, error: assessmentError } = await db.from("assessments")
        .select("round, route, level, policy, reasons, fields").eq("run_id", runId).order("id", { ascending: false }).limit(1).maybeSingle();
      if (assessmentError) throw fail("read run assessment", assessmentError);
      const { data: decisions, error: decisionsError } = await db.from("review_decisions")
        .select("kind, field, before, after, reason, analyst, policy, created_at").eq("run_id", runId).order("id");
      if (decisionsError) throw fail("read run decisions", decisionsError);
      const attempts = await db.from("postings").select("attempt, outcome, record_id, version, error, created_at").eq("run_id", runId).order("attempt");
      if (attempts.error) throw fail("read run postings", attempts.error);
      // How this run was cleared comes from the run itself (an unchanged post matches a version an earlier run created).
      const { count: created } = await db.from("portfolio_records").select("id", { count: "exact", head: true }).eq("source_run", runId);
      const posting = PostingView.parse(toPostingView(attempts.data, decisions, assessment?.policy ?? "unknown", Boolean(created)));
      return toRunView(RunRecord.parse(run), { filename: document.filename as string },
        latest ? ExtractionView.parse(latest) : null, assessment ? AssessmentView.parse(assessment) : null, events as AuditRow[],
        decisions.map((d) => DecisionView.parse(d)), posting);
    },
  };
}

export function createSupabaseAssessmentStore(db: SupabaseClient): AssessmentStore {
  return {
    async append(row) {
      const { error } = await db.from("assessments").insert(row);
      if (error) throw new Error(`store assessment: ${error.message}`);
    },
  };
}

export function createSupabaseExtractionStore(db: SupabaseClient): ExtractionStore {
  return {
    async append(row) {
      const { error } = await db.from("extractions").insert(row);
      if (error) throw new Error(`store extraction round ${row.round}: ${error.message}`);
    },
  };
}

export function createSupabaseKnownFundRegistry(db: SupabaseClient): KnownFundRegistry {
  return {
    async list() {
      const { data, error } = await db.from("known_funds").select("id, gp_name, fund_name, aliases");
      if (error) throw new Error(`read known funds: ${error.message}`);
      return data as KnownFund[];
    },
  };
}

export function createSupabaseDocumentLoader(db: SupabaseClient): DocumentLoader {
  return {
    // Retried: the first live held-out run failed once on "The connection to the database timed out" (K5).
    load: (documentId) => withRetry(async () => {
      const { data, error } = await db.from("documents")
        .select("id, sha256, filename, mime, size_bytes, storage_path, source, corpus_meta, created_at")
        .eq("id", documentId).single();
      if (error) throw new Error(`load document: ${error.message}`);
      const document = forPipeline(DocumentRecord.parse(data));
      const { data: blob, error: downloadError } = await db.storage.from(RAW_REPORTS_BUCKET).download(document.storage_path);
      if (downloadError) throw new Error(`download document: ${downloadError.message}`);
      return { document, bytes: new Uint8Array(await blob.arrayBuffer()) };
    }),
  };
}
