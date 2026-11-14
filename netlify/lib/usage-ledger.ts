import type { SupabaseClient } from "@supabase/supabase-js";
import type { UsageLedger } from "../../core/budget.ts";

// usage_ledger in Supabase: every LLM call from the site or a local script counts against the same daily budget.
export function createSupabaseUsageLedger(db: SupabaseClient, now: () => Date = () => new Date()): UsageLedger {
  return {
    async spentTodayUsd() {
      const startOfDay = new Date(now());
      startOfDay.setUTCHours(0, 0, 0, 0);
      const { data, error } = await db.from("usage_ledger").select("cost_usd").gte("created_at", startOfDay.toISOString());
      if (error) throw new Error(`read usage ledger: ${error.message}`);
      return data.reduce((sum, row) => sum + Number(row.cost_usd), 0);
    },
    async record(entry) {
      const { error } = await db.from("usage_ledger").insert({
        run_id: entry.runId.startsWith("local-") ? null : entry.runId, step: entry.step, model: entry.model,
        input_tokens: entry.inputTokens, output_tokens: entry.outputTokens, cost_usd: entry.costUsd,
      });
      if (error) throw new Error(`write usage ledger: ${error.message}`);
    },
  };
}
