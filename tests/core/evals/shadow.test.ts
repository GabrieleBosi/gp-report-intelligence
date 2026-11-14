import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compareShadow } from "../../../core/evals/shadow.ts";
import { withSpendCap, withStepModel, type LlmClient, type LlmRequest, type LlmResponse } from "../../../core/llm.ts";

const summary = (over = {}) => ({ documents: 12, unsafe: 0, keyFigureAccuracy: 1, allFigureAccuracy: 0.996, classificationAccuracy: 1, routeAccuracy: 11 / 12, ...over });

describe("compareShadow (SPEC-pipeline decision 1: switch only if key-figure accuracy holds)", () => {
  it("recommends the cheaper model when nothing gated gets worse, and states the saving", () => {
    const result = compareShadow({ step: "confidence", model: "claude-sonnet-5-5", baseline: summary(), candidate: summary(),
      baselineCostUsd: 0.35, candidateCostUsd: 0.18 });

    expect(result).toMatchObject({ verdict: "eligible", saving: 0.17 });
    expect(result.reason).toMatch(/no gated metric is worse.*saves \$0\.17 \(49%\).*ask first/i);
  });

  it("keeps Opus when the candidate loses key-figure accuracy or auto-posts a wrong figure", () => {
    expect(compareShadow({ step: "extract", model: "claude-sonnet-5-5", baseline: summary(), candidate: summary({ keyFigureAccuracy: 0.98 }),
      baselineCostUsd: 1, candidateCostUsd: 0.5 })).toMatchObject({ verdict: "keep", reason: expect.stringMatching(/key-figure accuracy 98\.0% < baseline 100\.0%/) });
    expect(compareShadow({ step: "extract", model: "claude-sonnet-5-5", baseline: summary(), candidate: summary({ unsafe: 1 }),
      baselineCostUsd: 1, candidateCostUsd: 0.5 }).verdict).toBe("keep");
  });
});

const Out = z.object({ ok: z.boolean() });
const req = (step: string): LlmRequest<{ ok: boolean }> => ({ step: step as LlmRequest<unknown>["step"], prompt: { id: "p", version: 1 },
  model: "claude-opus-5-5", effort: "low", system: "s", text: "t", schema: Out });
function fake(cost = 0.1): LlmClient & { models: string[] } {
  return { models: [], async complete<T>(r: LlmRequest<T>): Promise<LlmResponse<T>> {
    this.models.push(r.model);
    return { output: r.schema.parse({ ok: true }), cacheKey: "k", usage: { model: r.model, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: cost } };
  } };
}

describe("withStepModel", () => {
  it("runs one step on the candidate model and leaves the others alone", async () => {
    const inner = fake();
    const llm = withStepModel(inner, "confidence", "claude-sonnet-5-5");

    await llm.complete(req("classify"));
    await llm.complete(req("confidence"));

    expect(inner.models).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
  });
});

describe("withSpendCap", () => {
  it("refuses calls once the experiment has spent its cap, counting only live (uncached) cost", async () => {
    const llm = withSpendCap(fake(0.8), 2);

    await llm.complete(req("extract"));
    await llm.complete(req("extract"));
    await expect(llm.complete(req("extract"))).rejects.toThrow(/spend cap of \$2\.00 reached \(\$1\.60 spent\)/);
  });
});
