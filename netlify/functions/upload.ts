import type { Config } from "@netlify/functions";
import { UPLOAD_LIMITS } from "../../core/guardrails.ts";
import { handleUpload } from "../../core/upload.ts";
import { createSupabaseDocumentStore } from "../lib/document-store.ts";
import { countPages } from "../lib/pdf.ts";
import { createAdminClient } from "../lib/supabase.ts";
import { refuseForeignRequest } from "../../core/request-guard.ts";
import { json } from "../lib/http.ts";
import { withAccess } from "../lib/access.ts";

const MULTIPART_OVERHEAD = 64 * 1024; // form boundaries and headers around the file

// POST /api/upload (multipart/form-data, field "file"): guardrails, then step 1 (core/upload.ts).
export default withAccess(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const refused = refuseForeignRequest(req.headers);
  if (refused) return json({ error: refused.error }, refused.status);
  // Refuse an oversized body before reading it.
  if (Number(req.headers.get("content-length") ?? 0) > UPLOAD_LIMITS.maxBytes + MULTIPART_OVERHEAD) {
    return json({ error: `Files up to ${UPLOAD_LIMITS.maxBytes / 1024 / 1024} MB are accepted.`, code: "too_large" }, 413);
  }
  const db = createAdminClient({
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  if (!db) return json({ error: "storage not configured" }, 503);

  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return json({ error: "Expected a multipart form with a file field named \"file\".", code: "bad_request" }, 400);

    const result = await handleUpload({
      store: createSupabaseDocumentStore(db),
      countPdfPages: countPages,
      async uploadsLastHour() {
        const since = new Date(Date.now() - 3_600_000).toISOString();
        const { count, error } = await db.from("documents").select("id", { count: "exact", head: true })
          .eq("source", "upload").gte("created_at", since);
        if (error) throw new Error(`count uploads: ${error.message}`);
        return count ?? 0;
      },
    }, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    console.log(JSON.stringify({ level: "info", fn: "upload", status: result.status, ...("code" in result.body ? { code: result.body.code } : {}) }));
    return json(result.body, result.status);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", fn: "upload", msg: String(error) }));
    return json({ error: "The upload could not be stored. Please try again." }, 500);
  }
});

// Per-IP backstop if the owner's key leaks (SPEC-public-release W2); the hourly site-wide upload limit stays.
export const config: Config = {
  path: "/api/upload", method: ["POST"],
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 180, windowLimit: 10 },
};
