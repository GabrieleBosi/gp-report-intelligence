// Sketch step 8: post a cleared run to the internal portfolio system, exactly once, and log every attempt
// (SPEC-posting). One function for every path: the end of the pipeline, an approval, a retry.
import { err, ok, type Result } from "../result.ts";
import { buildRecord, type PortfolioRecord, type RecordInput } from "./record.ts";

export type PostResult = { kind: "posted" | "duplicate" | "unchanged"; recordId: string; version: number; supersedes: number | null };

// The internal system's contract. "unavailable" (outage, timeout, 5xx) may succeed on a retry; "rejected" (422) will not.
export class PortfolioError extends Error {
  readonly kind: "unavailable" | "rejected";
  constructor(kind: "unavailable" | "rejected", message: string) { super(message); this.kind = kind; }
}
export interface PortfolioSystem { post(record: PortfolioRecord, idempotencyKey: string): Promise<PostResult> }

export type PostingAttempt = {
  outcome: "posted" | "unchanged" | "failed" | "rejected";
  record_id: string | null; version: number | null; error: string | null; figures_hash: string | null;
};
// Our side: the attempt row, and the run's status change to posted, in one transaction.
export interface PostingLog { complete(runId: string, attempt: PostingAttempt, setPosted: boolean): Promise<void> }

// Which runs may be posted: cleared by step 7 (auto_post) or by an analyst. Mirrored by the database transition table.
const CLEARED = new Set(["ready_to_post", "approved"]);

export async function postRun(deps: { system: PortfolioSystem; log: PostingLog }, input: RecordInput): Promise<Result<PostResult>> {
  if (input.status !== "posted" && !CLEARED.has(input.status)) {
    return err("not_cleared", `This run is ${input.status.replaceAll("_", " ")}: only runs ready to post or approved by an analyst can be posted.`);
  }

  const record = await buildRecord(input);
  if (!record.ok) {
    await deps.log.complete(input.runId, { outcome: "rejected", record_id: null, version: null, error: record.error.message, figures_hash: null }, false);
    return record;
  }
  try {
    const result = await deps.system.post(record.value, input.runId);
    // A retry of a posted run: the system answers with the original record (idempotency key = run id); nothing new
    // happened, so nothing new is logged.
    if (input.status === "posted") return ok(result);
    await deps.log.complete(input.runId, {
      outcome: result.kind === "unchanged" ? "unchanged" : "posted", record_id: result.recordId, version: result.version,
      error: null, figures_hash: record.value.figures_hash,
    }, true);
    return ok(result);
  } catch (error) {
    const kind = error instanceof PortfolioError ? error.kind : "unavailable";
    const message = error instanceof Error ? error.message : String(error);
    await deps.log.complete(input.runId, {
      // The posting log is shown on the run page: it gets the public wording; the caller logs the raw text server-side.
      outcome: kind === "rejected" ? "rejected" : "failed", record_id: null, version: null, error: publicPostingError(kind, message), figures_hash: record.value.figures_hash,
    }, false);
    return err(kind, message);
  }
}

// What a person sees for a failed posting, in the API response and in the posting log on the run page (security audit
// 2026-10-11, finding 4): the portfolio system's own wording (database or connection errors) goes to the function log
// only; our own messages pass unchanged.
export function publicPostingError(code: string, message: string): string {
  if (code === "unavailable") return "The portfolio system is not reachable right now. Please retry the posting.";
  if (code === "rejected") return "The portfolio system refused the record: it failed validation. The details are in the function log.";
  return message;
}
