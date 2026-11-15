import type { Config, Context } from "@netlify/functions";
import { checkHealth } from "../../core/health.ts";
import { createAdminClient, supabaseProbes } from "../lib/supabase.ts";
import { json } from "../lib/http.ts";
import { withAccess } from "../lib/access.ts";

export default withAccess(async (_req: Request, context: Context) => {
  const env = {
    ANTHROPIC_API_KEY: Netlify.env.get("ANTHROPIC_API_KEY"),
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  };
  const report = await checkHealth({
    version: context.deploy.id,
    env,
    probes: supabaseProbes(createAdminClient(env)),
  });
  return json(report, report.status === "ok" ? 200 : 503);
});

export const config: Config = { path: "/api/health" };
