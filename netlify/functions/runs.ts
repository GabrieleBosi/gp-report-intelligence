import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { dailyBudgetUsd } from "../../core/budget.ts";
import { PIPELINE_VERSION } from "../../core/pipeline/version.ts";
import { requestRun } from "../../core/run-request.ts";
import { createSupabaseRunStore } from "../lib/run-store.ts";
import { createAdminClient } from "../lib/supabase.ts";
import { createSupabaseUsageLedger } from "../lib/usage-ledger.ts";
import { refuseForeignRequest } from "../../core/request-guard.ts";
import { json } from "../lib/http.ts";
import { withAccess } from "../lib/access.ts";

const CreateRunBody = z.object({ document_id: z.uuid() });


// POST /api/runs creates a queued run; the browser then calls POST /api/runs/:id/execute (background function).
// Two calls because a function cannot call this site over HTTP: it was behind a site-wide password gate when this was
// built, and the access key (ADR-0006) would have to be passed along. The browser holds the key and makes both calls.
export default withAccess(async (req: Request, context: Context) => {
  const db = createAdminClient({
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  if (!db) return json({ error: "storage not configured" }, 503);
  const store = createSupabaseRunStore(db);

  try {
    if (req.method === "POST" && !context.params.id) {
      const refused = refuseForeignRequest(req.headers, { json: true });
      if (refused) return json({ error: refused.error }, refused.status);
      const body = CreateRunBody.safeParse(await req.json().catch(() => null));
      if (!body.success) return json({ error: "Expected { document_id: <uuid> }." }, 400);
      const result = await requestRun({
        budgetUsd: dailyBudgetUsd(Netlify.env.get("DAILY_LLM_BUDGET_USD")),
        async documentExists(id) {
          const { count } = await db.from("documents").select("id", { count: "exact", head: true }).eq("id", id);
          return Boolean(count);
        },
        spentTodayUsd: () => createSupabaseUsageLedger(db).spentTodayUsd(),
        expireStale: (id) => store.expireStale(id),
        create: (id) => store.create(id, PIPELINE_VERSION),
      }, body.data.document_id);
      return json(result.body, result.status);
    }
    if (req.method === "GET" && context.params.id) {
      if (!z.uuid().safeParse(context.params.id).success) return json({ error: "Invalid run id." }, 400);
      const view = await store.view(context.params.id);
      return view ? json(view) : json({ error: "Run not found." }, 404);
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", fn: "runs", msg: String(error) }));
    return json({ error: "Could not process the request." }, 500);
  }
});

// Per-IP limit (SPEC-public-release W2): one of the plan's 5 rules, on the paths that write.
export const config: Config = {
  path: ["/api/runs", "/api/runs/:id"], method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 },
};
