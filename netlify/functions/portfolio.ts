import type { Config } from "@netlify/functions";
import { groupRecords, toPortfolioRow } from "../../core/posting/portfolio-view.ts";
import { createAdminClient } from "../lib/supabase.ts";
import { json } from "../lib/http.ts";
import { withAccess } from "../lib/access.ts";


// GET /api/portfolio: the mock portfolio system's records with their version history (read-only, SPEC-posting).
export default withAccess(async () => {
  const db = createAdminClient({
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  if (!db) return json({ error: "storage not configured" }, 503);
  const { data, error } = await db.from("portfolio_records")
    .select("fund_id, period_end, version, posted_at, source_run, payload->gp_name, payload->fund_name, payload->currency, payload->fund, payload->provenance")
    .order("id").limit(1000);
  if (error) {
    console.error(JSON.stringify({ level: "error", fn: "portfolio", msg: error.message }));
    return json({ error: "Could not read the portfolio system." }, 500);
  }
  const rows = data.map((r) => toPortfolioRow(
    { fund_id: r.fund_id, period_end: r.period_end, version: r.version, posted_at: r.posted_at, source_run: r.source_run }, r));
  return json({ records: groupRecords(rows) });
});

// Per-IP limit (SPEC-public-release W2): a refused request still costs an invocation.
export const config: Config = {
  path: "/api/portfolio", method: ["GET"],
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 },
};
