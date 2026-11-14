// The dev-split evaluation shared by npm run eval (replay) and npm run eval:shadow (one step on a candidate model).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatAmount, formatPercent, formatRatio } from "../corpus/generator/format.ts";
import { profileByFundName } from "../corpus/generator/profiles.ts";
import type { Golden } from "../core/evals/golden.ts";
import { summarize, type Summary } from "../core/evals/metrics.ts";
import { reportDocument, type DocumentReport } from "../core/evals/report.ts";
import type { LlmClient } from "../core/llm.ts";
import { classifyStep } from "../core/pipeline/classify.ts";
import { confidenceStep, type AssessmentRow } from "../core/pipeline/confidence-step.ts";
import { criticStep, slot } from "../core/pipeline/critic.ts";
import { extractStep } from "../core/pipeline/extract.ts";
import { normalizeStep } from "../core/pipeline/normalize-step.ts";
import { pdfRasterizer } from "../netlify/lib/pdf.ts";
import { devDocuments, ROOT } from "../tests/support/dev-corpus.ts";
import { KNOWN_FUNDS } from "../tests/support/known-funds.ts";

export type DevEvaluation = { reports: DocumentReport[]; summary: Summary; costByStep: Record<string, number>; unevaluated: string[] };

export async function evaluateDev(llm: LlmClient, split: "dev" | "heldout" = "dev"): Promise<DevEvaluation> {
  const golden = JSON.parse(await readFile(path.join(ROOT, "evals/golden.json"), "utf8")) as Golden;
  const dev = new Map(golden.documents.filter((d) => d.split === split).map((d) => [d.doc_id, d]));
  const costByStep: Record<string, number> = {};
  const noop = { append: async () => {} };
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const RATIOS = new Set(["tvpi", "dpi", "rvpi", "gross_moic"]);

  const reports: DocumentReport[] = [];
  const unevaluated: string[] = [];
  for (const { label, ctx } of await devDocuments(["native_pdf", "scanned_pdf", "xlsx"], split)) {
    const g = dev.get(label.doc_id);
    if (!g) continue;
    try {
    const steps: Record<string, unknown>[] = [];
    const run = async (step: { name: string; run(c: typeof ctx): Promise<{ ctx: typeof ctx; summary?: Record<string, unknown> }> }, c: typeof ctx) => {
      const out = await step.run(c);
      steps.push(out.summary ?? {});
      const cost = typeof out.summary?.costUsd === "number" ? out.summary.costUsd : 0;
      costByStep[step.name] = (costByStep[step.name] ?? 0) + cost;
      return out.ctx;
    };
    let c = await run(classifyStep(llm, { list: async () => KNOWN_FUNDS }, pdfRasterizer), ctx);
    c = await run(extractStep(llm, pdfRasterizer), c);
    c = await run(normalizeStep(noop), c);
    const round0 = c;
    c = await run(criticStep(llm, noop), c);
    const rows: AssessmentRow[] = [];
    c = await run(confidenceStep(llm, pdfRasterizer, { append: async (r) => { rows.push(r); } }), c);

    const style = profileByFundName(g.expected.classification.fund_name).style;
    reports.push(reportDocument({
      doc_id: g.doc_id, split: g.split, format: g.format, expected: g.expected, expected_route: g.expected_route,
      round0: round0.extraction ?? null, final: c.extraction ?? null, route: rows[0]?.route ?? null,
      round0Raw(p) {
        if (!round0.raw) return null;
        const m = /^portfolio_companies\[(\d+)\]\.(\w+)$/.exec(p);
        if (!m) return slot(round0.raw, p)?.get().raw ?? null;
        const name = g.expected.portfolio_companies[Number(m[1])]?.name ?? "";
        const i = round0.raw.portfolio.companies.findIndex((co) => key(co.name) === key(name));
        return i < 0 ? null : slot(round0.raw, `portfolio_companies[${i}].${m[2]}`)?.get().raw ?? null;
      },
      pageText: (page) => ctx.parsed?.pages[page - 1]?.text ?? "",
      printedForms(p, value) {
        if (value === null) return [];
        const field = p.split(".").at(-1) ?? "";
        if (field === "net_irr") return [formatPercent(value, 1, style.decimal)];
        if (RATIOS.has(field)) return [formatRatio(value, style.decimal)];
        return [formatAmount(value, style)];
      },
      costUsd: steps.reduce((t, s) => t + (typeof s.costUsd === "number" ? s.costUsd : 0), 0),
    }));
    } catch (error) {
      // A replay miss means the change makes the pipeline ask something new: it cannot be judged until it is recorded.
      unevaluated.push(`${label.doc_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  const summary = summarize(reports.map((r) => ({ ...r, keyFigures: { ...r.keyFigures, wrong: [] }, allFigures: { ...r.allFigures, wrong: [] } })));
  return { reports, summary, costByStep, unevaluated };
}
