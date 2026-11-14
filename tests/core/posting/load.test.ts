import { describe, expect, it } from "vitest";
import type { KnownFund } from "../../../core/pipeline/classify.ts";
import { postStoredRun, recordInputFrom, type StoredPosting } from "../../../core/posting/load.ts";
import type { Extraction } from "../../../core/schema.ts";

const extraction = { classification: { gp_name: "Harbourline Partners", fund_name: "Harbourline Growth II", period_end: "2025-09-30",
  report_type: "quarterly_report", currency: "USD" }, fund: {}, portfolio_companies: [], qualitative: { key_updates: [], outlook: null } } as unknown as Extraction;
const FUNDS: KnownFund[] = [{ id: "f-har", gp_name: "Harbourline Partners", fund_name: "Harbourline Growth II", aliases: [] }];
const stored = (over: Partial<StoredPosting> = {}): StoredPosting => ({
  run: { id: "run-1", status: "ready_to_post", pipeline_version: "pipeline@0.11.1" }, documentSha256: "d".repeat(64),
  classify: { known_fund_id: "f-har" }, extraction, policy: "policy@2", decisions: [], knownFunds: FUNDS, ...over,
});

describe("recordInputFrom", () => {
  it("takes the fund id the classify step recorded", () => {
    expect(recordInputFrom(stored())).toMatchObject({ runId: "run-1", status: "ready_to_post", knownFundId: "f-har", policy: "policy@2" });
  });

  it("prefers a triage assignment, and matches older runs (no recorded id) against the registry by name", () => {
    expect(recordInputFrom(stored({ classify: {}, decisions: [{ kind: "fund_assigned", field: "classification.fund_name",
      before: { raw: "Harbourline Growth ||" }, after: { raw: "Harbourline Growth II" }, analyst: "G", reason: null }] })).knownFundId).toBe("f-har");
    expect(recordInputFrom(stored({ classify: {} })).knownFundId).toBe("f-har");
    expect(recordInputFrom(stored({ classify: {}, extraction: { ...extraction, classification: { ...extraction.classification, fund_name: "Tessera Seed Fund I" } } })).knownFundId).toBeNull();
  });
});

describe("postStoredRun", () => {
  it("answers not_found for an unknown run or a run with nothing extracted", async () => {
    const result = await postStoredRun({ load: async () => null, system: { post: async () => { throw new Error("no"); } }, log: { complete: async () => {} } }, "run-x");

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});
