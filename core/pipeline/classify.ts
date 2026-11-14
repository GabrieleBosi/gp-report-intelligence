// Step 2 (classify). The LLM reads the report; code decides whether the fund is known. A fund that is not in the
// registry is routed to triage (sketch: "unknown GP or layout -> triage + add to evals"), whatever its confidence.
import type { LlmClient, LlmImage } from "../llm.ts";
import { VISION_DPI, type PageRasterizer } from "./extract.ts";
import { STEP_MODELS } from "./models.ts";
import { CLASSIFY_PROMPT, CLASSIFY_SCAN_PROMPT, classifyInput, type ClassifyOutput } from "./prompts/classify.ts";
import type { Step } from "./run.ts";

export type KnownFund = { id: string; gp_name: string; fund_name: string; aliases: string[] };
export interface KnownFundRegistry { list(): Promise<KnownFund[]> }

export type Classification = ClassifyOutput & {
  gp_status: "known" | "unknown";
  known_fund_id: string | null;
  missing: string[]; // fields the report does not state, or that failed validation
};

const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
// Legal-form and filler words that vary between a GP's documents without changing which fund is meant.
const FILLER = new Set(["fund", "the", "lp", "l", "p", "scsp", "scs", "sca", "sicav", "sicar", "ltd", "limited", "llc"]);

function normalizeFundName(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter((token) => token && !FILLER.has(token))
    .map((token) => ROMAN[token] ?? token)
    .join(" ");
}

// Exact match after normalization: "Alpenrose Buyout Fund IV, L.P." == "Alpenrose Buyout IV", but "Alpenrose Buyout V"
// is a different vintage and must never match fund IV.
export function matchKnownFund(fundName: string, registry: KnownFund[]): { status: "known"; fundId: string } | { status: "unknown" } {
  const wanted = normalizeFundName(fundName);
  if (!wanted) return { status: "unknown" };
  const fund = registry.find((f) => [f.fund_name, ...f.aliases].some((name) => normalizeFundName(name) === wanted));
  return fund ? { status: "known", fundId: fund.id } : { status: "unknown" };
}

// `rasterizer` is used only for scans (page 1 OCR'd): the page-1 image is then sent with the OCR text.
export function classifyStep(llm: LlmClient, registry: KnownFundRegistry, rasterizer?: PageRasterizer): Step {
  return {
    name: "classify",
    async run(ctx) {
      if (!ctx.parsed) throw new Error("no parsed text (the parse step must run first)");
      const loaded = ctx.loaded;
      const scan = rasterizer && loaded?.document.mime === "application/pdf" && ctx.parsed.pages[0]?.source === "ocr";
      const prompt = scan ? CLASSIFY_SCAN_PROMPT : CLASSIFY_PROMPT;
      const images: LlmImage[] | undefined = scan ? [{
        mediaType: "image/png", base64: (await rasterizer.renderPage(loaded.bytes, 1, VISION_DPI)).toString("base64"),
        id: `${loaded.document.sha256}#p1@${VISION_DPI}/${rasterizer.version}`,
      }] : undefined;
      const response = await llm.complete({
        step: "classify", prompt: { id: prompt.id, version: prompt.version }, model: STEP_MODELS.classify,
        effort: prompt.effort, system: prompt.system, text: classifyInput(ctx.parsed.pages),
        ...(images ? { images } : {}), schema: prompt.schema,
      });

      const out = response.output;
      const period_end = out.period_end && /^\d{4}-\d{2}-\d{2}$/.test(out.period_end) && !Number.isNaN(Date.parse(out.period_end)) ? out.period_end : null;
      const currency = out.currency && /^[A-Z]{3}$/.test(out.currency) ? out.currency : null;
      const missing = (["gp_name", "fund_name", "period_end", "currency"] as const)
        .filter((field) => ({ gp_name: out.gp_name, fund_name: out.fund_name, period_end, currency })[field] === null);
      const match = matchKnownFund(out.fund_name ?? "", await registry.list());

      const classification: Classification = {
        ...out, period_end, currency, missing,
        gp_status: match.status, known_fund_id: match.status === "known" ? match.fundId : null,
      };
      return {
        ctx: { ...ctx, classification },
        actor: `llm:${response.usage.model}`,
        summary: {
          fund_name: out.fund_name, gp_name: out.gp_name, period_end, currency, unit_statement: out.unit_statement,
          report_type: out.report_type, evidence_page: out.evidence_page, known_fund_id: classification.known_fund_id,
          gp_status: match.status, missing, costUsd: response.usage.costUsd, cached: response.cached ?? false,
        },
      };
    },
  };
}
