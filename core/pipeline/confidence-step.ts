// Step 7 (confidence high?): an independent read B from page images, then the pure assessment (core/confidence),
// stored with its policy version, and the run's final status. The LLM never decides the route or a confidence number.
import { assess, type Assessment } from "../confidence/assess.ts";
import { compareReadB, type ComparedReadB, type ReadBOutput } from "../confidence/compare.ts";
import { POLICY } from "../confidence/policy.ts";
import { xlsxReadB } from "../confidence/xlsx-read-b.ts";
import type { LlmClient, LlmImage, LlmResponse } from "../llm.ts";
import { VISION_DPI, type PageRasterizer } from "./extract.ts";
import { STEP_MODELS } from "./models.ts";
import { READ_B_INSTRUCTION, READ_B_PROMPT } from "./prompts/read-b.ts";
import type { DecidedStatus, RunContext, Step } from "./run.ts";

export type AssessmentRow = {
  run_id: string; round: number; route: Assessment["route"]; level: Assessment["level"];
  fields: Assessment["fields"]; reasons: string[]; policy: string;
};
export interface AssessmentStore { append(row: AssessmentRow): Promise<void> }

const STATUS: Record<Assessment["route"], DecidedStatus> = { auto_post: "ready_to_post", review: "needs_review", triage: "needs_triage" };

// Read B: images of the pages where read A found the key figures (pages only, never values), one vision call.
// Returns null when there is nothing to read from (no renderer, or not a PDF).
export async function runReadB(llm: LlmClient, rasterizer: PageRasterizer | undefined, ctx: RunContext):
  Promise<{ output: ReadBOutput; response: LlmResponse<ReadBOutput> | null; pages: number[] } | null> {
  // Workbooks: a label-anchored lookup in the cell grid, no LLM call (core/confidence/xlsx-read-b.ts).
  if (ctx.parsed?.kind === "xlsx") return { output: xlsxReadB(ctx.parsed.pages), response: null, pages: ctx.parsed.pages.map((p) => p.page) };
  if (!rasterizer || !ctx.raw || ctx.loaded?.document.mime !== "application/pdf") return null;
  const { raw, loaded } = { raw: ctx.raw, loaded: ctx.loaded };
  const cited = [...Object.values(raw.fund), ...raw.portfolio.companies.map((c) => c.total_value)]
    .flatMap((value) => (value.page ? [value.page] : []));
  const pages = cited.length > 0 ? [...new Set(cited)].sort((a, b) => a - b) : (ctx.parsed?.pages.slice(0, 3).map((p) => p.page) ?? [1]);
  const images: LlmImage[] = await Promise.all(pages.map(async (page) => ({
    mediaType: "image/png" as const,
    base64: (await rasterizer.renderPage(loaded.bytes, page, VISION_DPI)).toString("base64"),
    id: `${loaded.document.sha256}#p${page}@${VISION_DPI}/${rasterizer.version}`,
  })));
  const response = await llm.complete({
    step: "confidence", prompt: { id: READ_B_PROMPT.id, version: READ_B_PROMPT.version }, model: STEP_MODELS.confidence,
    effort: READ_B_PROMPT.effort, system: READ_B_PROMPT.system, text: READ_B_INSTRUCTION, images, schema: READ_B_PROMPT.schema,
  });
  return { output: response.output, response, pages };
}

const TRIAGE_PRERENDER_PAGES = 3;

export function confidenceStep(llm: LlmClient, rasterizer: PageRasterizer | undefined, store: AssessmentStore): Step {
  return {
    name: "confidence",
    async run(ctx) {
      if (!ctx.raw || !ctx.classification) throw new Error("nothing to assess (classify and extract must run first)");
      const { raw, classification } = ctx;
      const triageAnyway = classification.gp_status === "unknown" || classification.missing.length > 0 || !ctx.extraction;

      const b = triageAnyway ? null : await runReadB(llm, rasterizer, ctx);
      // Triage skips read B, so nothing has rendered its pages yet: render the first ones now (the caching rasterizer
      // keeps them for the review screen). No LLM call; a failure only means the review screen renders on demand.
      if (triageAnyway && rasterizer && ctx.loaded?.document.mime === "application/pdf") {
        const loaded = ctx.loaded;
        for (const page of (ctx.parsed?.pages ?? []).slice(0, TRIAGE_PRERENDER_PAGES)) {
          await rasterizer.renderPage(loaded.bytes, page.page, VISION_DPI).catch(() => {});
        }
      }
      const readB: ComparedReadB | null = b ? compareReadB(b.output, raw, classification) : null;
      const response = b?.response ?? null;
      const pages = b?.pages ?? [];

      const assessment = assess({
        classification, raw, extraction: ctx.extraction ?? null, checks: ctx.checks ?? [], issues: ctx.normalizationIssues ?? [], readB,
        source: ctx.loaded?.document.source,
      });
      await store.append({
        run_id: ctx.runId, round: ctx.extractionRound ?? 0, route: assessment.route, level: assessment.level,
        fields: assessment.fields, reasons: assessment.reasons, policy: assessment.policy,
      });

      return {
        ctx: { ...ctx, finalStatus: STATUS[assessment.route] },
        actor: response ? `llm:${response.usage.model}` : "system",
        summary: {
          route: assessment.route, level: assessment.level, policy: POLICY.version, readBPages: pages,
          readB: !b ? "none" : b.response ? "image" : "cell lookup",
          reasons: assessment.reasons.slice(0, 5), costUsd: response?.usage.costUsd ?? 0, cached: response?.cached ?? false,
        },
      };
    },
  };
}
