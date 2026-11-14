import { describe, expect, it } from "vitest";
import { classifyStep } from "../../../core/pipeline/classify.ts";
import { extractStep } from "../../../core/pipeline/extract.ts";
import { normalizeStep, type ExtractionRow } from "../../../core/pipeline/normalize-step.ts";
import { pdfRasterizer } from "../../../netlify/lib/pdf.ts";
import { createReplayLlm } from "../../../netlify/lib/replay-llm.ts";
import { devPdfDocuments, FIXTURES } from "../../support/dev-corpus.ts";
import { KNOWN_FUNDS } from "../../support/known-funds.ts";

// Recorded real Claude responses (scripts/record-fixtures.ts extract), replayed at zero cost in CI.
describe("classify -> extract -> normalize on the dev corpus (replayed)", () => {
  it("reproduces every dev label exactly: all values, pages, companies and narrative, with no issues", async () => {
    const llm = createReplayLlm(FIXTURES);
    for (const { label, ctx } of await devPdfDocuments()) {
      const rows: ExtractionRow[] = [];
      let out = (await classifyStep(llm, { list: async () => KNOWN_FUNDS }).run(ctx)).ctx;
      out = (await extractStep(llm, pdfRasterizer).run(out)).ctx;
      out = (await normalizeStep({ append: async (row) => { rows.push(row); } }).run(out)).ctx;

      expect(out.normalizationIssues, label.doc_id).toEqual([]);
      expect(out.extraction, label.doc_id).toEqual(label.expected);
      // Only the chart trap needs the vision fallback: its NAV exists only as pixels in a chart.
      expect(out.raw?.visionFields, label.doc_id).toEqual(label.trap === "chart_nav" ? ["fund.nav"] : []);
      expect(out.checks?.filter((c) => c.status === "fail").map((c) => c.id), label.doc_id).toEqual(label.expected_flags);
      expect(rows.map((r) => r.round), label.doc_id).toEqual([0]);
    }
  });
});
