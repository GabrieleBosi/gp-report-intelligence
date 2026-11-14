import { describe, expect, it } from "vitest";
import { assess } from "../../../core/confidence/assess.ts";
import { compareReadB } from "../../../core/confidence/compare.ts";
import { classifyStep } from "../../../core/pipeline/classify.ts";
import { confidenceStep, runReadB, type AssessmentRow } from "../../../core/pipeline/confidence-step.ts";
import { criticStep } from "../../../core/pipeline/critic.ts";
import { extractStep } from "../../../core/pipeline/extract.ts";
import { normalizeRaw, normalizeStep } from "../../../core/pipeline/normalize-step.ts";
import type { RawExtraction } from "../../../core/pipeline/prompts/extract.ts";
import type { RunContext } from "../../../core/pipeline/run.ts";
import { pdfRasterizer } from "../../../netlify/lib/pdf.ts";
import { createReplayLlm } from "../../../netlify/lib/replay-llm.ts";
import { devPdfDocuments, FIXTURES } from "../../support/dev-corpus.ts";
import { KNOWN_FUNDS } from "../../support/known-funds.ts";

const llm = createReplayLlm(FIXTURES);
const noop = { append: async () => {} };

async function throughCritic(ctx: RunContext): Promise<RunContext> {
  let out = (await classifyStep(llm, { list: async () => KNOWN_FUNDS }).run(ctx)).ctx;
  out = (await extractStep(llm, pdfRasterizer).run(out)).ctx;
  out = (await normalizeStep(noop).run(out)).ctx;
  return (await criticStep(llm, noop).run(out)).ctx;
}

// Recorded real Claude responses (scripts/record-fixtures.ts confidence), replayed at zero cost in CI.
describe("confidence on the dev corpus (replayed)", () => {
  it("routes every dev document as its label expects, with the expected reasons", async () => {
    const docs = await devPdfDocuments();
    expect(docs).toHaveLength(8);
    for (const { label, ctx } of docs) {
      const rows: AssessmentRow[] = [];
      const step = await confidenceStep(llm, pdfRasterizer, { append: async (r) => { rows.push(r); } }).run(await throughCritic(ctx));

      expect(rows[0]?.route, label.doc_id).toBe(label.expected_route);
      if (label.trap === "tvpi_misprint") expect(rows[0]?.reasons.join(" "), label.doc_id).toMatch(/report itself may be inconsistent/);
      if (label.trap === "chart_nav") expect(rows[0]?.reasons.join(" "), label.doc_id).toMatch(/vision fallback/);
      if (label.expected_route === "auto_post") expect(step.ctx.finalStatus, label.doc_id).toBe("ready_to_post");
    }
  }, 30_000); // renders and replays all 8 dev PDFs
});

// Safety: whatever single key figure read A gets wrong by one digit, the document must not be auto-posted.
const misread = (raw: string) => raw.replace(/(\d)(?!.*\d)/, (d) => String((Number(d) + 1) % 10));

describe("safety property: a misread key figure is never auto-posted (replayed)", () => {
  it("routes every single-digit misread of every key figure, on every dev document, away from auto_post", async () => {
    let cases = 0;
    for (const { label, ctx } of await devPdfDocuments()) {
      const base = await throughCritic(ctx);
      if (!base.raw || !base.classification) throw new Error(`${label.doc_id}: pipeline produced nothing`);
      const readB = await runReadB(llm, pdfRasterizer, base);
      if (!readB) throw new Error(`${label.doc_id}: no read B`);

      const keyPaths: [string, (r: RawExtraction) => { raw: string | null }][] = [
        ...(["commitment", "paid_in", "distributions", "nav", "tvpi", "dpi"] as const).map((k) =>
          [`fund.${k}`, (r: RawExtraction) => r.fund[k]] as [string, (r: RawExtraction) => { raw: string | null }]),
        ...base.raw.portfolio.companies.map((_, i) =>
          [`portfolio_companies[${i}].total_value`, (r: RawExtraction) => r.portfolio.companies[i]?.total_value ?? { raw: null }] as [string, (r: RawExtraction) => { raw: string | null }]),
      ];
      for (const [path, at] of keyPaths) {
        const wrong = structuredClone(base.raw);
        const slot = at(wrong);
        if (!slot.raw) continue;
        slot.raw = misread(slot.raw);
        const { extraction, checks, issues } = normalizeRaw(wrong, base.classification);
        const result = assess({ classification: base.classification, raw: wrong, extraction, checks, issues,
          readB: compareReadB(readB.output, wrong, base.classification) });
        expect(result.route, `${label.doc_id} ${path} misread as ${slot.raw}`).not.toBe("auto_post");
        cases++;
      }
    }
    expect(cases).toBeGreaterThan(60);
  });
});
