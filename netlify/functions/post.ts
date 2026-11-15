import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { postStoredRun } from "../../core/posting/load.ts";
import { publicPostingError } from "../../core/posting/post.ts";
import { createMockPortfolioSystem, createSupabasePostingLog } from "../lib/portfolio-system.ts";
import { createSupabasePostingLoader } from "../lib/posting-store.ts";
import { createAdminClient } from "../lib/supabase.ts";
import { refuseForeignRequest } from "../../core/request-guard.ts";
import { json } from "../lib/http.ts";
import { withAccess } from "../lib/access.ts";

const STATUS: Record<string, number> = { not_cleared: 409, not_found: 404, unavailable: 503, rejected: 422, invalid_record: 422 };

// POST /api/runs/:id/post: retry posting a cleared run (the automatic paths call the same postStoredRun).
export default withAccess(async (req: Request, context: Context) => {
  const refused = refuseForeignRequest(req.headers);
  if (refused) return json({ error: refused.error }, refused.status);
  const db = createAdminClient({
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  if (!db) return json({ error: "storage not configured" }, 503);
  if (!z.uuid().safeParse(context.params.id).success) return json({ error: "Invalid run id.", code: "bad_request" }, 400);
  try {
    const result = await postStoredRun({
      load: createSupabasePostingLoader(db), system: createMockPortfolioSystem(db), log: createSupabasePostingLog(db),
    }, context.params.id ?? "");
    console.log(JSON.stringify({ level: "info", fn: "post", ok: result.ok, ...(result.ok ? { kind: result.value.kind } : { code: result.error.code }) }));
    if (result.ok) return json({ status: "posted", ...result.value });
    if (result.error.code === "unavailable" || result.error.code === "rejected") {
      console.error(JSON.stringify({ level: "warn", fn: "post", code: result.error.code, msg: result.error.message }));
    }
    return json({ error: publicPostingError(result.error.code, result.error.message), code: result.error.code }, STATUS[result.error.code] ?? 500);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", fn: "post", msg: String(error) }));
    return json({ error: "The posting could not be completed. Please try again." }, 500);
  }
});

// Per-IP limit (SPEC-public-release W2): one of the plan's 5 rules, on the paths that write.
export const config: Config = {
  path: "/api/runs/:id/post", method: ["POST"],
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 },
};
