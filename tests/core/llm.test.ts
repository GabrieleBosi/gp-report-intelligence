import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dailyBudgetUsd, estimateCostUsd, withBudget, type UsageLedger, type UsageRecord } from "../../core/budget.ts";
import { cacheKey, type LlmClient, type LlmRequest, type LlmResponse } from "../../core/llm.ts";
import { costUsd } from "../../core/pricing.ts";

const Schema = z.object({ fund_name: z.string() });
const request = (overrides: Partial<LlmRequest<z.infer<typeof Schema>>> = {}): LlmRequest<z.infer<typeof Schema>> => ({
  step: "classify", prompt: { id: "classify", version: 1 }, model: "claude-opus-5-5", effort: "low",
  system: "Classify the report.", text: "<document>Alpenrose Buyout IV</document>", schema: Schema, ...overrides,
});

describe("costUsd", () => {
  it("prices input, output and cache tokens at the model's per-million rates", () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache read, $5 cache write per million tokens.
    const cost = costUsd("claude-opus-5-5", { inputTokens: 10_000, outputTokens: 2_000, cacheReadTokens: 50_000, cacheWriteTokens: 1_000 });

    expect(cost).toBeCloseTo(0.04 + 0.04 + 0.01 + 0.005, 10);
  });

  it("refuses to price an unknown model rather than recording zero", () => {
    expect(() => costUsd("claude-unknown", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toThrow(/unknown/);
  });
});

describe("cacheKey", () => {
  it("is stable for the same request", async () => {
    expect(await cacheKey(request())).toBe(await cacheKey(request()));
  });

  it("changes when the prompt version changes, so a new prompt never replays an old answer", async () => {
    expect(await cacheKey(request({ prompt: { id: "classify", version: 2 } }))).not.toBe(await cacheKey(request()));
  });

  it("changes with the model, effort, input text and images", async () => {
    const base = await cacheKey(request());
    const variants = await Promise.all([
      cacheKey(request({ model: "claude-sonnet-5-5" })),
      cacheKey(request({ effort: "high" })),
      cacheKey(request({ text: "<document>Other</document>" })),
      cacheKey(request({ images: [{ mediaType: "image/png", base64: "AAAA" }] })),
    ]);
    expect(new Set([base, ...variants]).size).toBe(5);
  });
});

describe("cacheKey with identified images", () => {
  it("keys an image by its stable identity, so pixel differences between machines do not break replay", async () => {
    const page = (base64: string) => request({ images: [{ mediaType: "image/png", base64, id: "sha#p1@130/pdfjs@6.4" }] });

    expect(await cacheKey(page("AAAA"))).toBe(await cacheKey(page("BBBB")));
  });

  it("still changes when the image identity changes", async () => {
    const withId = (id: string) => request({ images: [{ mediaType: "image/png", base64: "AAAA", id }] });

    expect(await cacheKey(withId("sha#p1@130/pdfjs@6.4"))).not.toBe(await cacheKey(withId("sha#p2@130/pdfjs@6.4")));
  });
});

describe("withBudget", () => {
  class MemoryLedger implements UsageLedger {
    records: UsageRecord[] = [];
    private readonly alreadySpent: number;
    constructor(alreadySpent = 0) { this.alreadySpent = alreadySpent; }
    async spentTodayUsd() { return this.alreadySpent + this.records.reduce((s, r) => s + r.costUsd, 0); }
    async record(entry: UsageRecord) { this.records.push(entry); }
  }
  const fakeLlm = (costUsd: number): LlmClient & { calls: number } => ({
    calls: 0,
    async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
      this.calls++;
      return {
        output: req.schema.parse({ fund_name: "Alpenrose Buyout IV" }), cacheKey: "k",
        usage: { model: req.model, inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd },
      };
    },
  });

  it("records the usage of every call against the run", async () => {
    const ledger = new MemoryLedger();
    const llm = withBudget(fakeLlm(0.02), ledger, { budgetUsd: 15, runId: "run-1" });

    await llm.complete(request());

    expect(ledger.records).toEqual([{ runId: "run-1", step: "classify", model: "claude-opus-5-5", inputTokens: 100, outputTokens: 10, costUsd: 0.02 }]);
  });

  it("refuses a call once today's spend has reached the budget, before calling the model", async () => {
    const inner = fakeLlm(0.02);
    const llm = withBudget(inner, new MemoryLedger(15), { budgetUsd: 15, runId: "run-1" });

    await expect(llm.complete(request())).rejects.toThrow(/budget/i);
    expect(inner.calls).toBe(0);
  });

  it("refuses a call whose estimated cost would cross the budget, so one large run cannot overshoot it", async () => {
    const inner = fakeLlm(0.02);
    const huge = request({ text: "x".repeat(400_000) }); // ~100k input tokens: ~$0.40 on Opus 5.5
    const llm = withBudget(inner, new MemoryLedger(14.9), { budgetUsd: 15, runId: "run-1" });

    await expect(llm.complete(huge)).rejects.toThrow(/budget/i);
    await expect(llm.complete(request())).resolves.toBeDefined(); // a small call still fits
    expect(inner.calls).toBe(1);
  });
});

describe("dailyBudgetUsd", () => {
  it("is $5 a day when DAILY_LLM_BUDGET_USD is not set (SPEC-public-release: the default lowered from $15)", () => {
    expect(dailyBudgetUsd(undefined)).toBe(5);
  });

  it("takes a positive number of dollars", () => {
    expect(dailyBudgetUsd("2.5")).toBe(2.5);
  });

  it("takes 0 as a hard stop: the owner can turn all spending off", () => {
    expect(dailyBudgetUsd("0")).toBe(0);
  });

  it("falls back to the default for a value that is not a number of dollars: NaN would never stop a call", () => {
    for (const value of ["", " ", "abc", "-1", "Infinity"]) expect(dailyBudgetUsd(value), value).toBe(5);
  });
});

describe("estimateCostUsd", () => {
  it("prices the request before it is sent: text at ~4 characters a token, each image, and a nominal answer", () => {
    const text = estimateCostUsd(request({ system: "", text: "x".repeat(40_000) }));
    const withImages = estimateCostUsd(request({ system: "", text: "x".repeat(40_000), images: [{ mediaType: "image/png", base64: "" }, { mediaType: "image/png", base64: "" }] }));

    expect(text).toBeCloseTo((10_000 * 4 + 2_000 * 20) / 1e6, 6);
    expect(withImages).toBeGreaterThan(text);
  });
});
