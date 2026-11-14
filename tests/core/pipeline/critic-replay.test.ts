import { describe, expect, it } from "vitest";
import { classifyStep } from "../../../core/pipeline/classify.ts";
import { criticStep } from "../../../core/pipeline/critic.ts";
import { extractStep } from "../../../core/pipeline/extract.ts";
import { normalizeStep, type ExtractionRow } from "../../../core/pipeline/normalize-step.ts";
import { pdfRasterizer } from "../../../netlify/lib/pdf.ts";
import { createReplayLlm } from "../../../netlify/lib/replay-llm.ts";
import { devPdfDocuments, FIXTURES } from "../../support/dev-corpus.ts";
import { KNOWN_FUNDS } from "../../support/known-funds.ts";

// Recorded real Claude responses (scripts/record-fixtures.ts critic), replayed at zero cost in CI.
describe("critic on the dev corpus (replayed)", () => {
  it("confirms the misprinted TVPI as printed, keeps it flagged, and leaves clean documents alone", async () => {
    const llm = createReplayLlm(FIXTURES);
    for (const { label, ctx } of await devPdfDocuments()) {
      const rows: ExtractionRow[] = [];
      const store = { append: async (row: ExtractionRow) => { rows.push(row); } };
      let out = (await classifyStep(llm, { list: async () => KNOWN_FUNDS }).run(ctx)).ctx;
      out = (await extractStep(llm, pdfRasterizer).run(out)).ctx;
      out = (await normalizeStep(store).run(out)).ctx;
      const critic = await criticStep(llm, store).run(out);

      const failed = (critic.ctx.checks ?? []).filter((c) => c.status === "fail").map((c) => c.id);
      expect(failed, label.doc_id).toEqual(label.expected_flags);
      if (label.trap === "tvpi_misprint") {
        expect(critic.summary, label.doc_id).toMatchObject({ rounds: 1, corrected: [], confirmed: expect.arrayContaining(["fund.tvpi"]) });
        expect(critic.ctx.extraction, label.doc_id).toEqual(label.expected);
        expect(rows.map((r) => r.round), label.doc_id).toEqual([0, 1]);
      } else {
        expect(critic.summary, label.doc_id).toMatchObject({ rounds: 0 });
        expect(rows.map((r) => r.round), label.doc_id).toEqual([0]);
      }
    }
  });
});
