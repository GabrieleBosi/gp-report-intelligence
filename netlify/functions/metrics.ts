import type { Config } from "@netlify/functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMetrics, METRIC_COLUMNS, type MetricRows } from "../../core/showcase/metrics.ts";
import { createAdminClient } from "../lib/supabase.ts";
import { json } from "../lib/http.ts";
import { withAccess } from "../lib/access.ts";


async function all<T>(db: SupabaseClient, table: keyof typeof METRIC_COLUMNS): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(METRIC_COLUMNS[table]).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data as T[]));
    if (data.length < 1000) return rows;
  }
}

// GET /api/metrics: live operating numbers for the showcase (SPEC-showcase): counts only, from the columns listed in
// core/showcase/metrics.ts. Read-only.
export default withAccess(async () => {
  const db = createAdminClient({
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  if (!db) return json({ error: "storage not configured" }, 503);
  try {
    const [documents, pipeline_runs, assessments, review_decisions, postings, portfolio_records, usage_ledger] = await Promise.all([
      all<MetricRows["documents"][number]>(db, "documents"), all<MetricRows["pipeline_runs"][number]>(db, "pipeline_runs"),
      all<MetricRows["assessments"][number]>(db, "assessments"), all<MetricRows["review_decisions"][number]>(db, "review_decisions"),
      all<MetricRows["postings"][number]>(db, "postings"), all<MetricRows["portfolio_records"][number]>(db, "portfolio_records"),
      all<MetricRows["usage_ledger"][number]>(db, "usage_ledger"),
    ]);
    return json(computeMetrics({ documents, pipeline_runs, assessments, review_decisions, postings, portfolio_records, usage_ledger }, new Date()));
  } catch (e) {
    console.error(JSON.stringify({ level: "error", fn: "metrics", msg: e instanceof Error ? e.message : String(e) }));
    return json({ error: "Could not read the operating numbers." }, 500);
  }
});

export const config: Config = { path: "/api/metrics", method: ["GET"] };
