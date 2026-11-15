import type { Config } from "@netlify/functions";
import { computeMetrics, METRIC_COLUMNS, type MetricRows } from "../../core/showcase/metrics.ts";
import { allRows, createAdminClient } from "../lib/supabase.ts";
import { json } from "../lib/http.ts";
import { withAccess } from "../lib/access.ts";


// GET /api/metrics: live operating numbers for the showcase (SPEC-showcase): counts only, from the columns listed in
// core/showcase/metrics.ts. Read-only.
export default withAccess(async () => {
  const db = createAdminClient({
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  if (!db) return json({ error: "storage not configured" }, 503);
  const all = <T>(table: keyof typeof METRIC_COLUMNS) => allRows<T>(db, table, METRIC_COLUMNS[table]);
  try {
    const [documents, pipeline_runs, assessments, review_decisions, postings, portfolio_records, usage_ledger] = await Promise.all([
      all<MetricRows["documents"][number]>("documents"), all<MetricRows["pipeline_runs"][number]>("pipeline_runs"),
      all<MetricRows["assessments"][number]>("assessments"), all<MetricRows["review_decisions"][number]>("review_decisions"),
      all<MetricRows["postings"][number]>("postings"), all<MetricRows["portfolio_records"][number]>("portfolio_records"),
      all<MetricRows["usage_ledger"][number]>("usage_ledger"),
    ]);
    return json(computeMetrics({ documents, pipeline_runs, assessments, review_decisions, postings, portfolio_records, usage_ledger }, new Date()));
  } catch (e) {
    console.error(JSON.stringify({ level: "error", fn: "metrics", msg: e instanceof Error ? e.message : String(e) }));
    return json({ error: "Could not read the operating numbers." }, 500);
  }
});

export const config: Config = { path: "/api/metrics", method: ["GET"] };
