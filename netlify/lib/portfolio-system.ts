import type { SupabaseClient } from "@supabase/supabase-js";
import { PortfolioError, type PortfolioSystem, type PostingLog, type PostResult } from "../../core/posting/post.ts";

// The mock internal portfolio system (SPEC-posting decision 1): Supabase-backed, behind the PortfolioSystem port, so a
// real system replaces this adapter and nothing else. Its API is one SQL function (migration 20261011121711_posting).
export function toPostResult(answer: { kind: string; record_id: string; version: number; supersedes: number | null }): PostResult {
  return { kind: answer.kind as PostResult["kind"], recordId: answer.record_id, version: answer.version, supersedes: answer.supersedes };
}

// A validation refusal (the system's 422) is final; anything else (timeout, connection, 5xx) may pass on a retry.
export function toPortfolioError(error: { code?: string; message: string }): PortfolioError {
  return new PortfolioError(error.code === "23514" ? "rejected" : "unavailable", error.message);
}

export function createMockPortfolioSystem(db: SupabaseClient): PortfolioSystem {
  return {
    async post(record, idempotencyKey) {
      const { data, error } = await db.rpc("portfolio_post", { p_run: idempotencyKey, p_record: record });
      if (error) throw toPortfolioError(error);
      return toPostResult(data);
    },
  };
}

// Our side of step 8: the attempt, the audit event and the status change, in one transaction.
export function createSupabasePostingLog(db: SupabaseClient): PostingLog {
  return {
    async complete(runId, attempt, setPosted) {
      const { error } = await db.rpc("complete_posting", { p_run: runId, p_attempt: attempt, p_set_posted: setPosted });
      if (error) throw new Error(`record posting attempt: ${error.message}`);
    },
  };
}
