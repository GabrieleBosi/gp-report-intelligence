// The run engine: a plain list of steps. Each step is timed and audited; the first failure ends the run as `failed`
// with a readable reason. LLM budget checks live in the LlmClient decorator (core/budget.ts), so a budget refusal
// surfaces here like any other step error.
import type { DocumentRecord } from "../documents.ts";
import type { CheckResult } from "../checks/identities.ts";
import type { Extraction } from "../schema.ts";
import type { Classification } from "./classify.ts";
import type { NormalizationIssue } from "./normalize-step.ts";
import type { ParsedDocument } from "./parse.ts";
import type { RawExtraction } from "./prompts/extract.ts";

export type StepName = "load" | "classify" | "parse" | "extract" | "normalize" | "critic" | "confidence";

// Execution order. Classify (sketch 2) needs the parsed text (sketch 3), so it runs after parse.
export const PIPELINE_STEPS: StepName[] = ["load", "parse", "classify", "extract", "normalize", "critic", "confidence"];

// Numbers from the process sketch, so the audit trail reads in the business's own terms.
export const SKETCH_STEP: Record<StepName, number> = { load: 1, classify: 2, parse: 3, extract: 4, normalize: 5, critic: 6, confidence: 7 };

export type LoadedDocument = { document: DocumentRecord; bytes: Uint8Array };

// Grows as steps are added; each step reads what earlier steps produced.
export type RunContext = {
  runId: string; documentId: string; loaded?: LoadedDocument; parsed?: ParsedDocument; classification?: Classification;
  raw?: RawExtraction; extraction?: Extraction | null; checks?: CheckResult[]; normalizationIssues?: NormalizationIssue[];
  extractionRound?: number; // 0 = step 5, 1-2 = critic rounds: which stored round the confidence step assessed
  finalStatus?: DecidedStatus; // set by step 7; otherwise the run ends as "extracted"
};

export type DecidedStatus = "ready_to_post" | "needs_review" | "needs_triage";

export type StepOutcome = { ctx: RunContext; summary?: Record<string, unknown>; actor?: string };
export type Step = { name: StepName; run(ctx: RunContext): Promise<StepOutcome> };

export type RunAuditEvent = { run_id: string; step: number; actor: string; event: string; payload: Record<string, unknown> };
export type RunFinish = { status: "extracted" | DecidedStatus } | { status: "failed"; error: string };

export interface RunStore {
  claim(runId: string): Promise<{ documentId: string } | null>; // atomically queued -> running; null if not queued
  finish(runId: string, outcome: RunFinish): Promise<void>;
  appendAudit(event: RunAuditEvent): Promise<void>;
}

const MAX_ERROR_LENGTH = 500;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function executeRun(runId: string, steps: Step[], store: RunStore,
  clock: () => number = () => performance.now()): Promise<"extracted" | DecidedStatus | "failed" | "not_claimed"> {
  const claimed = await store.claim(runId);
  if (!claimed) return "not_claimed";

  let ctx: RunContext = { runId, documentId: claimed.documentId };
  for (const step of steps) {
    const started = clock();
    try {
      const outcome = await step.run(ctx);
      ctx = outcome.ctx;
      await store.appendAudit({
        run_id: runId, step: SKETCH_STEP[step.name], actor: outcome.actor ?? "system", event: `${step.name}.completed`,
        payload: { durationMs: Math.round(clock() - started), ...outcome.summary },
      });
    } catch (error) {
      const reason = message(error);
      await store.appendAudit({
        run_id: runId, step: SKETCH_STEP[step.name], actor: "system", event: `${step.name}.failed`,
        payload: { durationMs: Math.round(clock() - started), error: reason.slice(0, MAX_ERROR_LENGTH) },
      });
      await store.finish(runId, { status: "failed", error: `${step.name}: ${reason}`.slice(0, MAX_ERROR_LENGTH) });
      return "failed";
    }
  }
  const status = ctx.finalStatus ?? "extracted";
  await store.finish(runId, { status });
  return status;
}
