// POST /api/runs/:id/review as pure orchestration: validate, check the analyst's view is current, apply the step-9
// rules (actions.ts), store atomically. The function only adapts HTTP and the database to this.
import { z } from "zod";
import type { Result } from "../result.ts";
import { decide, type ReviewOutcome, type ReviewState } from "./actions.ts";

export const ReviewRequest = z.object({
  analyst: z.string().max(80),
  seen_status: z.string(),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("accept_field"), field: z.string().max(80) }),
    z.object({ kind: z.literal("correct"), field: z.string().max(80), raw: z.string().min(1).max(40), page: z.number().int() }),
    z.object({ kind: z.literal("approve"), reason: z.string().max(500).optional() }),
    z.object({ kind: z.literal("reject"), reason: z.string().max(500) }),
    z.object({ kind: z.literal("assign_fund"), fundId: z.string().max(80) }),
  ]),
});

export type ReviewApiDeps = {
  load(runId: string): Promise<ReviewState | null>;
  apply(runId: string, seenStatus: string, outcome: ReviewOutcome): Promise<Result<string>>;
  // Posting right after an approval (SPEC-posting decision 2); returns the run's status afterwards.
  afterApproval?(runId: string): Promise<string>;
};
export type ReviewApiResult = { status: 200; body: { status: string } } | { status: 400 | 404 | 409; body: { error: string; code: string } };

const STALE = "This run changed since you opened it (another decision was made). Reload the page to see its current state.";

export async function handleReview(deps: ReviewApiDeps, runId: string, body: unknown): Promise<ReviewApiResult> {
  const request = ReviewRequest.safeParse(body);
  if (!request.success) return { status: 400, body: { error: "The decision could not be read.", code: "bad_request" } };
  const state = await deps.load(runId);
  if (!state) return { status: 404, body: { error: "Run not found.", code: "not_found" } };
  if (state.status !== request.data.seen_status) return { status: 409, body: { error: STALE, code: "stale" } };

  const decided = decide(state, request.data.action, request.data.analyst);
  if (!decided.ok) {
    return { status: decided.error.code === "forbidden_transition" ? 409 : 400, body: { error: decided.error.message, code: decided.error.code } };
  }
  const applied = await deps.apply(runId, request.data.seen_status, decided.value);
  if (!applied.ok) return { status: 409, body: { error: STALE, code: "stale" } };
  if (applied.value === "approved" && deps.afterApproval) return { status: 200, body: { status: await deps.afterApproval(runId) } };
  return { status: 200, body: { status: applied.value } };
}
