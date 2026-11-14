import { describe, expect, it } from "vitest";
import { classifyStep } from "../../../core/pipeline/classify.ts";
import { createReplayLlm } from "../../../netlify/lib/replay-llm.ts";
import { devPdfDocuments, FIXTURES } from "../../support/dev-corpus.ts";
import { KNOWN_FUNDS } from "../../support/known-funds.ts";

// Recorded real Claude responses (scripts/record-fixtures.ts classify), replayed at zero cost in CI.
describe("classify on the dev corpus (replayed)", () => {
  it("identifies GP, fund, period and currency of every dev document and matches the registry", async () => {
    const docs = await devPdfDocuments();
    expect(docs.length).toBeGreaterThan(0);

    for (const { label, ctx } of docs) {
      const { ctx: out } = await classifyStep(createReplayLlm(FIXTURES), { list: async () => KNOWN_FUNDS }).run(ctx);
      const expected = label.expected.classification;
      expect(out.classification, label.doc_id).toMatchObject({
        gp_name: expected.gp_name, fund_name: expected.fund_name, period_end: expected.period_end,
        currency: expected.currency, report_type: expected.report_type, gp_status: "known", missing: [],
      });
    }
  });
});
