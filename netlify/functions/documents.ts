import type { Config } from "@netlify/functions";
import { listDocuments, toDocumentSummary } from "../../core/documents.ts";
import { createSupabaseDocumentStore } from "../lib/document-store.ts";
import { createAdminClient } from "../lib/supabase.ts";
import { json } from "../lib/http.ts";
import { withAccess } from "../lib/access.ts";

export default withAccess(async () => {
  const client = createAdminClient({
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  if (!client) return json({ error: "storage not configured" }, 503);

  try {
    const documents = await listDocuments(createSupabaseDocumentStore(client));
    return json({ documents: documents.map(toDocumentSummary) });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", fn: "documents", msg: String(error) }));
    return json({ error: "could not load documents" }, 500);
  }
});

// Per-IP limit (SPEC-public-release W2): a refused request still costs an invocation.
export const config: Config = {
  path: "/api/documents", method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 },
};
