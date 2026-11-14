// Daily spend cap (SPEC-platform: DAILY_LLM_BUDGET_USD). Decorates any LlmClient: checks before each call and records
// the cost after it, so no pipeline step can forget either.
import { LlmError, type LlmClient, type LlmRequest } from "./llm.ts";
import { costUsd } from "./pricing.ts";

export type UsageRecord = { runId: string; step: string; model: string; inputTokens: number; outputTokens: number; costUsd: number };

export interface UsageLedger {
  spentTodayUsd(): Promise<number>; // UTC day
  record(entry: UsageRecord): Promise<void>;
}

// A conservative price for a request before it is sent: ~4 characters per input token, ~1,600 tokens per page image
// (130 dpi), and a nominal 2,000 output tokens (thinking included). Used to refuse a call that would cross the cap.
const CHARS_PER_TOKEN = 4;
const TOKENS_PER_IMAGE = 1_600;
const NOMINAL_OUTPUT_TOKENS = 2_000;
export function estimateCostUsd(request: LlmRequest<unknown>): number {
  const inputTokens = Math.ceil((request.system.length + request.text.length) / CHARS_PER_TOKEN) + (request.images?.length ?? 0) * TOKENS_PER_IMAGE;
  return costUsd(request.model, { inputTokens, outputTokens: NOMINAL_OUTPUT_TOKENS, cacheReadTokens: 0, cacheWriteTokens: 0 });
}

// DAILY_LLM_BUDGET_USD in dollars per UTC day; 0 stops all spending. Anything that is not a number of dollars gets the
// default: a NaN budget would compare false and never stop a call.
export const DEFAULT_DAILY_BUDGET_USD = 5;
export function dailyBudgetUsd(value: string | undefined): number {
  const usd = Number(value);
  return value?.trim() && Number.isFinite(usd) && usd >= 0 ? usd : DEFAULT_DAILY_BUDGET_USD;
}

export function withBudget(inner: LlmClient, ledger: UsageLedger, opts: { budgetUsd: number; runId: string }): LlmClient {
  return {
    async complete(request) {
      const spent = await ledger.spentTodayUsd();
      if (spent + estimateCostUsd(request as LlmRequest<unknown>) > opts.budgetUsd) {
        throw new LlmError("budget_exceeded",
          `Daily LLM budget of $${opts.budgetUsd.toFixed(2)} reached ($${spent.toFixed(2)} spent today). Try again tomorrow.`);
      }
      const response = await inner.complete(request);
      const { model, inputTokens, outputTokens, costUsd } = response.usage;
      await ledger.record({ runId: opts.runId, step: request.step, model, inputTokens, outputTokens, costUsd });
      return response;
    },
  };
}
