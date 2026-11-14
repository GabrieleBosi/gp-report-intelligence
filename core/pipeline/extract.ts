// Step 4 (extract per section). Four small, independent calls in parallel: smaller schemas are read more reliably,
// and one section failing does not hide what the others found. If the text read misses a key figure, that section
// is asked again from the page images (vision fallback), filling only what is missing.
import type { ZodType } from "zod";
import type { Effort, LlmClient, LlmImage, LlmResponse } from "../llm.ts";
import { STEP_MODELS } from "./models.ts";
import { EXTRACT_PROMPTS, EXTRACT_VISION_PROMPTS, extractInput, type RawExtraction, type RawValue } from "./prompts/extract.ts";
import type { Step } from "./run.ts";

export interface PageRasterizer {
  version: string; // part of each image's cache identity
  renderPage(pdf: Uint8Array, page: number, dpi: number): Promise<Buffer>;
}

// 130 dpi keeps an A4 page under 1,568 px on its long side, the size Claude processes without downscaling.
export const VISION_DPI = 130;
const FUND_KEY_FIGURES = ["commitment", "paid_in", "distributions", "nav", "tvpi", "dpi"] as const;

type Prompt<T> = { id: string; version: number; effort: Effort; system: string; schema: ZodType<T> };

export function extractStep(llm: LlmClient, rasterizer?: PageRasterizer): Step {
  return {
    name: "extract",
    async run(ctx) {
      if (!ctx.parsed) throw new Error("no parsed text (the parse step must run first)");
      const text = extractInput(ctx.parsed.pages);
      const ask = <T>(prompt: Prompt<T>, input: string, images?: LlmImage[]) =>
        llm.complete({ step: "extract", prompt: { id: prompt.id, version: prompt.version }, model: STEP_MODELS.extract,
          effort: prompt.effort, system: prompt.system, text: input, schema: prompt.schema, ...(images ? { images } : {}) });

      const [fund, portfolio, operating, qualitative] = await Promise.all([
        ask(EXTRACT_PROMPTS.fund, text), ask(EXTRACT_PROMPTS.portfolio, text),
        ask(EXTRACT_PROMPTS.operating, text), ask(EXTRACT_PROMPTS.qualitative, text),
      ]);
      const responses: LlmResponse<unknown>[] = [fund, portfolio, operating, qualitative];
      const raw: RawExtraction = {
        readMode: "text", visionFields: [],
        fund: fund.output, portfolio: portfolio.output, operating: operating.output, qualitative: qualitative.output,
      };

      const missingFund = FUND_KEY_FIGURES.filter((k) => raw.fund[k].raw === null);
      const missingTotals = raw.portfolio.companies.filter((c) => c.total_value.raw === null).map((c) => c.name);
      let visionFallback: { sections: string[]; pages: number[]; filled: string[] } | undefined;

      if (rasterizer && ctx.loaded?.document.mime === "application/pdf" && (missingFund.length > 0 || missingTotals.length > 0)) {
        const loaded = ctx.loaded;
        const sections: string[] = [];
        const pagesUsed = new Set<number>();
        const filled: string[] = [];
        // The section's other figures say where it is printed; with no clue at all, look at the first pages.
        const pagesOf = (values: RawValue[]) => {
          const cited = [...new Set(values.flatMap((v) => (v.page ? [v.page] : [])))].sort((a, b) => a - b);
          return cited.length > 0 ? cited : ctx.parsed?.pages.slice(0, 3).map((p) => p.page) ?? [1];
        };
        const images = (pages: number[]) => Promise.all(pages.map(async (page): Promise<LlmImage> => {
          pagesUsed.add(page);
          const png = await rasterizer.renderPage(loaded.bytes, page, VISION_DPI);
          return { mediaType: "image/png", base64: png.toString("base64"), id: `${loaded.document.sha256}#p${page}@${VISION_DPI}/${rasterizer.version}` };
        }));
        const instruction = "Extract the requested section from the page images.";

        if (missingFund.length > 0) {
          sections.push("fund");
          const response = await ask(EXTRACT_VISION_PROMPTS.fund, instruction, await images(pagesOf(Object.values(raw.fund))));
          responses.push(response);
          for (const key of missingFund) {
            const seen = response.output[key];
            if (seen.raw !== null && seen.page !== null) { raw.fund[key] = seen; filled.push(`fund.${key}`); }
          }
        }
        if (missingTotals.length > 0) {
          sections.push("portfolio");
          const cited = raw.portfolio.companies.flatMap((c) => [c.invested, c.realized, c.unrealized, c.total_value]);
          const response = await ask(EXTRACT_VISION_PROMPTS.portfolio, instruction, await images(pagesOf(cited)));
          responses.push(response);
          raw.portfolio.companies.forEach((company, i) => {
            const seen = response.output.companies.find((c) => c.name.toLowerCase() === company.name.toLowerCase());
            if (company.total_value.raw === null && seen && seen.total_value.raw !== null && seen.total_value.page !== null) {
              company.total_value = seen.total_value;
              filled.push(`portfolio_companies[${i}].total_value`);
            }
          });
        }
        raw.visionFields = filled;
        visionFallback = { sections, pages: [...pagesUsed].sort((a, b) => a - b), filled };
      }

      const costUsd = Math.round(responses.reduce((sum, r) => sum + r.usage.costUsd, 0) * 1e6) / 1e6;
      return {
        ctx: { ...ctx, raw },
        actor: `llm:${fund.usage.model}`,
        summary: {
          sections: 4, companies: portfolio.output.companies.length, keyUpdates: qualitative.output.key_updates.length,
          ...(visionFallback ? { visionFallback } : {}),
          costUsd, cached: responses.every((r) => r.cached === true),
        },
      };
    },
  };
}
