import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { handleReview } from "../../core/review/api.ts";
import { postStoredRun } from "../../core/posting/load.ts";
import { buildQueue } from "../../core/review/queue.ts";
import { createMockPortfolioSystem, createSupabasePostingLog } from "../lib/portfolio-system.ts";
import { createSupabasePostingLoader } from "../lib/posting-store.ts";
import { createSupabaseReviewStore } from "../lib/review-store.ts";
import { createSupabaseKnownFundRegistry } from "../lib/run-store.ts";
import { createAdminClient } from "../lib/supabase.ts";
import { refuseForeignRequest } from "../../core/request-guard.ts";
import { json } from "../lib/http.ts";
import { withAccess } from "../lib/access.ts";


// GET /api/review/queue and POST /api/runs/:id/review (SPEC-review). Rules: core/review; storage: one atomic call.
export default withAccess(async (req: Request, context: Context) => {
  const db = createAdminClient({
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  if (!db) return json({ error: "storage not configured" }, 503);
  const store = createSupabaseReviewStore(db);

  try {
    if (req.method === "GET" && new URL(req.url).pathname.endsWith("/funds")) {
      // The triage picker: only registry funds can be assigned (SPEC-review decision 3).
      const funds = await createSupabaseKnownFundRegistry(db).list();
      return json({ funds: funds.map(({ id, gp_name, fund_name }) => ({ id, gp_name, fund_name })) });
    }
    if (req.method === "GET" && !context.params.id) return json(buildQueue(await store.queueRows()));
    if (req.method === "POST" && context.params.id) {
      const refused = refuseForeignRequest(req.headers, { json: true });
      if (refused) return json({ error: refused.error }, refused.status);
      if (!z.uuid().safeParse(context.params.id).success) return json({ error: "Invalid run id.", code: "bad_request" }, 400);
      const knownFunds = await createSupabaseKnownFundRegistry(db).list();
      const result = await handleReview({
        load: (runId) => store.load(runId, knownFunds),
        apply: (runId, seen, outcome) => store.apply(runId, seen, outcome),
        // SPEC-posting decision 2: an approval posts right away; a posting failure leaves the run approved (retry).
        async afterApproval(runId) {
          const posted = await postStoredRun({ load: createSupabasePostingLoader(db), system: createMockPortfolioSystem(db),
            log: createSupabasePostingLog(db) }, runId).catch((error: unknown) => ({ ok: false as const, error: { code: "error", message: String(error) } }));
          if (!posted.ok) console.error(JSON.stringify({ level: "warn", fn: "review", msg: `posting after approval failed: ${posted.error.message}` }));
          return posted.ok ? "posted" : "approved";
        },
      }, context.params.id, await req.json().catch(() => null));
      console.log(JSON.stringify({ level: "info", fn: "review", status: result.status, ...("code" in result.body ? { code: result.body.code } : {}) }));
      return json(result.body, result.status);
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", fn: "review", msg: String(error) }));
    return json({ error: "The decision could not be stored. Please try again." }, 500);
  }
});

// Per-IP limit (SPEC-public-release W2): one of the plan's 5 rules, on the paths that write.
export const config: Config = {
  path: ["/api/review/queue", "/api/review/funds", "/api/runs/:id/review"], method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 },
};
