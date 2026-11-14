import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { dailyBudgetUsd, withBudget } from "../../core/budget.ts";
import { createCachedLlm } from "../../core/llm-cache.ts";
import { classifyStep } from "../../core/pipeline/classify.ts";
import { confidenceStep } from "../../core/pipeline/confidence-step.ts";
import { cachingRasterizer } from "../../core/review/page-image.ts";
import { criticStep } from "../../core/pipeline/critic.ts";
import { extractStep } from "../../core/pipeline/extract.ts";
import { loadStep } from "../../core/pipeline/load.ts";
import { normalizeStep } from "../../core/pipeline/normalize-step.ts";
import { parseStep } from "../../core/pipeline/parse.ts";
import { executeRun } from "../../core/pipeline/run.ts";
import { postStoredRun } from "../../core/posting/load.ts";
import { anthropicFromEnv } from "../lib/anthropic-llm.ts";
import { createSupabaseLlmCache } from "../lib/llm-cache-store.ts";
import { createOcr, createPdfPageOcr } from "../lib/ocr.ts";
import { createPageImageCache } from "../lib/page-cache.ts";
import { createMockPortfolioSystem, createSupabasePostingLog } from "../lib/portfolio-system.ts";
import { createSupabasePostingLoader } from "../lib/posting-store.ts";
import { extractTextPages, pdfRasterizer, renderPageToPng } from "../lib/pdf.ts";
import {
  createSupabaseAssessmentStore, createSupabaseDocumentLoader, createSupabaseExtractionStore, createSupabaseKnownFundRegistry,
  createSupabaseRunStore,
} from "../lib/run-store.ts";
import { createAdminClient } from "../lib/supabase.ts";
import { createSupabaseUsageLedger } from "../lib/usage-ledger.ts";
import { readSheets } from "../lib/xlsx.ts";
import { refuseForeignRequest } from "../../core/request-guard.ts";
import { withAccess } from "../lib/access.ts";

// Executes one pipeline run (ADR-0002). Background: the caller gets 202 at once; progress is read via GET /api/runs/:id.
export default withAccess(async (req: Request, context: Context) => {
  const runId = context.params.id;
  const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level, fn: "run-pipeline", runId, msg, ...extra }));
  // Background: the caller always gets 202, so a refused request simply does nothing (security audit, finding 1).
  if (refuseForeignRequest(req.headers)) return log("warn", "refused a request from another site");
  if (!runId || !z.uuid().safeParse(runId).success) return log("warn", "invalid run id");

  const db = createAdminClient({
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  if (!db) return log("error", "storage not configured");

  // Cache outside the budget: a cached answer is free and never counts against the daily cap (core/llm-cache.ts).
  const llm = createCachedLlm(
    withBudget(anthropicFromEnv(Netlify.env.get("ANTHROPIC_API_KEY")), createSupabaseUsageLedger(db), {
      budgetUsd: dailyBudgetUsd(Netlify.env.get("DAILY_LLM_BUDGET_USD")), runId,
    }),
    createSupabaseLlmCache(db),
  );
  const ocr = createPdfPageOcr(renderPageToPng);
  // Pages rendered for the vision steps are kept for the review screen (same 130 dpi, same cache path).
  const rasterizer = cachingRasterizer(pdfRasterizer, createPageImageCache(db));
  const steps = [
    loadStep(createSupabaseDocumentLoader(db)),
    parseStep({ pdfTextPages: extractTextPages, ocrPage: ocr.ocrPage, ocrDone: ocr.close, sheets: readSheets }),
    classifyStep(llm, createSupabaseKnownFundRegistry(db), rasterizer),
    extractStep(llm, rasterizer),
    normalizeStep(createSupabaseExtractionStore(db)),
    criticStep(llm, createSupabaseExtractionStore(db)),
    confidenceStep(llm, rasterizer, createSupabaseAssessmentStore(db)),
  ];

  const started = performance.now();
  try {
    const outcome = await executeRun(runId, steps, createSupabaseRunStore(db));
    log("info", "run finished", { outcome, ms: Math.round(performance.now() - started) });
    if (outcome === "ready_to_post") {
      // Sketch step 8, auto-post (SPEC-posting decision 2). A posting failure never fails the run: it stays
      // ready_to_post with the failed attempt logged, and can be retried.
      const posted = await postStoredRun({ load: createSupabasePostingLoader(db), system: createMockPortfolioSystem(db),
        log: createSupabasePostingLog(db) }, runId).catch((error: unknown) => ({ ok: false as const, error: { code: "error", message: String(error) } }));
      log(posted.ok ? "info" : "error", "posting", posted.ok ? { kind: posted.value.kind, version: posted.value.version } : { error: posted.error.message });
    }
  } catch (error) {
    // The store itself failed (e.g. DB unreachable while recording): nothing more can be written, so log it.
    log("error", "run aborted", { error: String(error) });
  } finally {
    await ocr.close();
  }
});

// Used by scripts/check-function-bundles.sh: OCR one page with only the files shipped in this bundle.
export async function ocrSelfCheck(png: Buffer) {
  const worker = await createOcr();
  try { return await worker.recognize(png); } finally { await worker.close(); }
}

// Per-IP backstop if the owner's key leaks (SPEC-public-release W2); the daily model budget stays.
export const config: Config = {
  path: "/api/runs/:id/execute", method: ["POST"], background: true,
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 180, windowLimit: 10 },
};
