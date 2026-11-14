// POST /api/runs as pure orchestration: the document must exist, and a run is refused up front once today's LLM spend
// reaches the budget (SPEC-pipeline success criterion 8: refused before any LLM call, and the UI says so).
import { checkRunBudget } from "./guardrails.ts";
import type { Result } from "./result.ts";

// A run nobody can still be working on (security audit 2026-10-11, finding 2): queued but never started, or running
// past the background function's 15-minute limit (a crash, an out-of-memory kill, a timeout). Left alone, it would hold
// the one-active-run-per-document index and refuse every new run on that document.
export const STALE_AFTER_MINUTES = { queued: 5, running: 16 } as const;

export type RunRequestDeps = {
  budgetUsd: number;
  expireStale(documentId: string): Promise<number>; // marks the document's stale runs failed; returns how many
  documentExists(documentId: string): Promise<boolean>;
  spentTodayUsd(): Promise<number>;
  create(documentId: string): Promise<Result<{ runId: string }>>;
};
export type RunRequestResult =
  | { status: 201; body: { run_id: string } }
  | { status: 404 | 409; body: { error: string } }
  | { status: 429; body: { error: string; code: "budget_exceeded" } };

export async function requestRun(deps: RunRequestDeps, documentId: string): Promise<RunRequestResult> {
  if (!(await deps.documentExists(documentId))) return { status: 404, body: { error: "Document not found." } };
  const budget = checkRunBudget(await deps.spentTodayUsd(), deps.budgetUsd);
  if (!budget.ok) return { status: 429, body: { error: budget.message, code: budget.code } };
  await deps.expireStale(documentId);
  const created = await deps.create(documentId);
  return created.ok ? { status: 201, body: { run_id: created.value.runId } } : { status: 409, body: { error: created.error.message } };
}
