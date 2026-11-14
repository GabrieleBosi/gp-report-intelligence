import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { pageImage } from "../../core/review/page-image.ts";
import { countPages, pdfRasterizer, renderPageToPng } from "../lib/pdf.ts";
import { createPageImageCache } from "../lib/page-cache.ts";
import { createAdminClient, RAW_REPORTS_BUCKET } from "../lib/supabase.ts";
import { API_SECURITY_HEADERS, json } from "../lib/http.ts";
import { withAccess } from "../lib/access.ts";


// GET /api/runs/:id/pages/:page -> the source page as PNG (SPEC-review). Server-side only: storage stays private.
export default withAccess(async (_req: Request, context: Context) => {
  const db = createAdminClient({
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  if (!db) return json({ error: "storage not configured" }, 503);
  if (!z.uuid().safeParse(context.params.id).success) return json({ error: "Invalid run id." }, 400);
  const page = Number(context.params.page);
  const cache = createPageImageCache(db);

  try {
    const result = await pageImage({
      rasterizerVersion: pdfRasterizer.version,
      async documentOf(runId) {
        const { data, error } = await db.from("pipeline_runs").select("documents(sha256, mime, storage_path)").eq("id", runId).maybeSingle();
        if (error) throw new Error(`read run: ${error.message}`);
        return (data?.documents as unknown as { sha256: string; mime: string; storage_path: string } | null) ?? null;
      },
      readCache: (path) => cache.read(path),
      writeCache: (path, png) => cache.write(path, png),
      async loadFile(storagePath) {
        const { data, error } = await db.storage.from(RAW_REPORTS_BUCKET).download(storagePath);
        if (error) throw new Error(`download document: ${error.message}`);
        return new Uint8Array(await data.arrayBuffer());
      },
      pageCount: countPages,
      render: renderPageToPng,
    }, context.params.id ?? "", page);
    if (result.status !== 200) return json({ error: result.error }, result.status);
    // A page never changes for a given document and renderer: cache privately in the browser.
    return new Response(new Uint8Array(result.png), { headers: { ...API_SECURITY_HEADERS,
      "content-type": "image/png", "cache-control": "private, max-age=86400", "x-page-cache": result.cached ? "hit" : "miss" } });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", fn: "page-image", msg: String(error) }));
    return json({ error: "The page image could not be produced." }, 500);
  }
});

// Per-IP limit (SPEC-public-release W2): a refused request still costs an invocation.
export const config: Config = {
  path: "/api/runs/:id/pages/:page", method: ["GET"],
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 },
};
