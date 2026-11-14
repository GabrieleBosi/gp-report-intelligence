import { describe, expect, it } from "vitest";
import { STEP_MODELS } from "../../../core/pipeline/models.ts";

// SPEC-pipeline decision 1 applied (evals/shadow/2026-10-11-summary.md, approved by the product owner 2026-10-11).
describe("STEP_MODELS", () => {
  it("runs every step on Opus 5.5 after the held-out rollback of the Sonnet switch", () => {
    expect(STEP_MODELS).toEqual({
      classify: "claude-opus-5-5", extract: "claude-opus-5-5", critic: "claude-opus-5-5", confidence: "claude-opus-5-5",
    });
  });
});
