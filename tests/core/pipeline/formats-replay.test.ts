import { describe, expect, it } from "vitest";
import { classifyStep } from "../../../core/pipeline/classify.ts";
import { assess } from "../../../core/confidence/assess.ts";
import { compareReadB } from "../../../core/confidence/compare.ts";
import { xlsxReadB } from "../../../core/confidence/xlsx-read-b.ts";
import { confidenceStep, type AssessmentRow } from "../../../core/pipeline/confidence-step.ts";
import { criticStep } from "../../../core/pipeline/critic.ts";
import { extractStep } from "../../../core/pipeline/extract.ts";
import { normalizeRaw, normalizeStep } from "../../../core/pipeline/normalize-step.ts";
import type { RawExtraction } from "../../../core/pipeline/prompts/extract.ts";
import type { RunContext } from "../../../core/pipeline/run.ts";
import { pdfRasterizer } from "../../../netlify/lib/pdf.ts";
import { createReplayLlm } from "../../../netlify/lib/replay-llm.ts";
import { devDocuments, FIXTURES } from "../../support/dev-corpus.ts";
import { KNOWN_FUNDS } from "../../support/known-funds.ts";

const llm = createReplayLlm(FIXTURES);
const noop = { append: async () => {} };

async function throughCritic(ctx: RunContext): Promise<RunContext> {
  let out = (await classifyStep(llm, { list: async () => KNOWN_FUNDS }, pdfRasterizer).run(ctx)).ctx;
  out = (await extractStep(llm, pdfRasterizer).run(out)).ctx;
  out = (await normalizeStep(noop).run(out)).ctx;
  return (await criticStep(llm, noop).run(out)).ctx;
}

// Recorded real Claude responses on the OCR and spreadsheet paths (P12), replayed at zero cost.
describe("steps 2-6 on scans and workbooks (dev, replayed)", () => {
  it("extracts the Meridian workbooks exactly as labeled, citing sheets as pages", async () => {
    const docs = await devDocuments(["xlsx"]);
    expect(docs.map((d) => d.label.doc_id)).toEqual(["meridian-i-2025q4", "meridian-i-2026q1"]);
    for (const { label, ctx } of docs) {
      const out = await throughCritic(ctx);

      expect(out.extraction, label.doc_id).toEqual(label.expected);
    }
  });

  it("routes the Meridian workbooks as labeled: the cell lookup agrees with read A on every key figure", async () => {
    const docs = await devDocuments(["xlsx"]);
    expect(docs).toHaveLength(2);
    for (const { label, ctx } of docs) {
      const rows: AssessmentRow[] = [];
      const { summary } = await confidenceStep(llm, pdfRasterizer, { append: async (r) => { rows.push(r); } }).run(await throughCritic(ctx));

      expect(summary?.readB, label.doc_id).toBe("cell lookup");
      expect(rows[0]?.route, `${label.doc_id}: ${rows[0]?.reasons.join(" / ")}`).toBe(label.expected_route);
      expect(rows[0]?.fields.every((f) => f.reads === "agree"), label.doc_id).toBe(true);
    }
  });

  it("safety on workbooks: a single-digit misread of any key figure by read A is never auto-posted", async () => {
    const misread = (raw: string) => raw.replace(/(\d)(?!.*\d)/, (d) => String((Number(d) + 1) % 10));
    let cases = 0;
    for (const { label, ctx } of await devDocuments(["xlsx"])) {
      const base = await throughCritic(ctx);
      if (!base.raw || !base.classification || base.parsed?.kind !== "xlsx") throw new Error(`${label.doc_id}: nothing extracted`);
      const readB = xlsxReadB(base.parsed.pages);
      const slots = (r: RawExtraction) => [...(["commitment", "paid_in", "distributions", "nav", "tvpi", "dpi"] as const).map((k) => r.fund[k]),
        ...r.portfolio.companies.map((c) => c.total_value)];
      for (let i = 0; i < slots(base.raw).length; i++) {
        const wrong = structuredClone(base.raw);
        const slot = slots(wrong)[i];
        if (!slot?.raw) continue;
        slot.raw = misread(slot.raw);
        const { raw, extraction, checks, issues } = normalizeRaw(wrong, base.classification);
        const result = assess({ classification: base.classification, raw, extraction, checks, issues, readB: compareReadB(readB, raw, base.classification) });
        expect(result.route, `${label.doc_id} slot ${i} misread as ${slot.raw}`).not.toBe("auto_post");
        cases++;
      }
    }
    expect(cases).toBe(22); // 2 workbooks x (6 fund key figures + 5 company totals)
  });

  // Measured on dev (docs/error-analysis/2026-10-11-ocr-fund-names.md): OCR damages the fund name's roman numeral and
  // some non-key fields (an EBITDA decimal, country codes, narrative typos). classify-scan@1 reads names from the image.
  it("classifies the scans exactly and extracts every key figure from OCR text", async () => {
    const docs = await devDocuments(["scanned_pdf"]);
    expect(docs).toHaveLength(2);
    for (const { label, ctx } of docs) {
      expect(ctx.parsed?.pages.every((p) => p.source === "ocr" && (p.quality ?? 0) > 80), label.doc_id).toBe(true);
      const out = await throughCritic(ctx);

      expect(out.extraction?.classification, label.doc_id).toEqual(label.expected.classification);
      expect(out.classification?.gp_status, label.doc_id).toBe("known");
      expect(out.extraction?.fund, label.doc_id).toEqual(label.expected.fund);
      expect(out.extraction?.portfolio_companies.map((c) => [c.name, c.total_value?.value]), label.doc_id)
        .toEqual(label.expected.portfolio_companies.map((c) => [c.name, c.total_value?.value]));
    }
  });

  // Measured routes, asserted exactly. The trap scan goes to review as designed. The Nordkap scan's label expects
  // auto_post, but OCR leaves two company country codes unreadable, and routing rule 2 (confirmed by the product owner
  // 2026-10-11) sends any normalization issue to review: every key figure is still high.
  const SCAN_ROUTES: Record<string, { route: string; reasons: RegExp }> = {
    "harbourline-ii-2025q3-tvpi-misprint-scan": { route: "review", reasons: /report itself may be inconsistent/ },
    "nordkap-iii-2026q1-scan": { route: "review", reasons: /^portfolio_companies\[\d\]\.country: ISO 3166-1 alpha-2\.$/ },
  };

  it("routes each scan as measured, with the reasons that explain it", async () => {
    const docs = await devDocuments(["scanned_pdf"]);
    expect(docs.map((d) => d.label.doc_id).sort()).toEqual(Object.keys(SCAN_ROUTES).sort());
    for (const { label, ctx } of docs) {
      const rows: AssessmentRow[] = [];
      await confidenceStep(llm, pdfRasterizer, { append: async (r) => { rows.push(r); } }).run(await throughCritic(ctx));
      const expected = SCAN_ROUTES[label.doc_id];

      expect(rows[0]?.route, label.doc_id).toBe(expected?.route);
      expect(rows[0]?.reasons.some((r) => expected?.reasons.test(r)), `${label.doc_id}: ${rows[0]?.reasons.join(" / ")}`).toBe(true);
      if (label.doc_id === "nordkap-iii-2026q1-scan") expect(rows[0]?.fields.every((f) => f.level === "high")).toBe(true);
    }
  });
});
