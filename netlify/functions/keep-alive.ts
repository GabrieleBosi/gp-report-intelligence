import type { Config } from "@netlify/functions";
import { checkHealth } from "../../core/health.ts";
import { createAdminClient, supabaseProbes } from "../lib/supabase.ts";

// The Supabase project is on the free plan, which pauses after 7 days without activity. One small
// read of the database and of storage each day keeps it active, so the live mode still works when it is next used,
// weeks later. Scheduled: no URL, runs on the published deploy only; the outcome is in the function log.
export default async (req: Request) => {
  const { next_run } = (await req.json().catch(() => ({}))) as { next_run?: string };
  const env = {
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    ANTHROPIC_API_KEY: Netlify.env.get("ANTHROPIC_API_KEY"),
  };
  const report = await checkHealth({ version: "keep-alive", env, probes: supabaseProbes(createAdminClient(env)) });
  console.log(JSON.stringify({ level: report.status === "ok" ? "info" : "warn", fn: "keep-alive", status: report.status, checks: report.checks, next_run }));
};

// 06:00 UTC = 08:00 in Zurich in summer (07:00 in winter): a daily read is all the free plan needs.
export const config: Config = { schedule: "0 6 * * *" };
