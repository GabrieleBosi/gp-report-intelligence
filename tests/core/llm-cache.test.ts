import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createCachedLlm, type CachedResponse, type LlmCache } from "../../core/llm-cache.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../../core/llm.ts";

const Schema = z.object({ fund_name: z.string() });
const request: LlmRequest<z.infer<typeof Schema>> = {
  step: "classify", prompt: { id: "classify", version: 1 }, model: "claude-opus-5-5", effort: "low",
  system: "Classify.", text: "<document>Alpenrose</document>", schema: Schema,
};

class MemoryCache implements LlmCache {
  entries = new Map<string, CachedResponse>();
  async get(key: string) { return this.entries.get(key) ?? null; }
  async put(key: string, entry: CachedResponse) { this.entries.set(key, entry); }
}

const live = (): LlmClient & { calls: number } => ({
  calls: 0,
  async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
    this.calls++;
    return { output: req.schema.parse({ fund_name: "Alpenrose Buyout IV" }), cacheKey: "",
      usage: { model: req.model, inputTokens: 900, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.0044 } };
  },
});

describe("createCachedLlm", () => {
  it("calls the model on a miss and stores the answer", async () => {
    const inner = live();
    const cache = new MemoryCache();

    const response = await createCachedLlm(inner, cache).complete(request);

    expect(inner.calls).toBe(1);
    expect(response.cached).toBe(false);
    expect([...cache.entries.values()][0]).toMatchObject({ prompt: "classify@1", model: "claude-opus-5-5", output: { fund_name: "Alpenrose Buyout IV" } });
  });

  it("answers a repeat request from the cache, free and without calling the model", async () => {
    const inner = live();
    const llm = createCachedLlm(inner, new MemoryCache());
    await llm.complete(request);

    const repeat = await llm.complete(request);

    expect(inner.calls).toBe(1);
    expect(repeat).toMatchObject({ cached: true, output: { fund_name: "Alpenrose Buyout IV" }, usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 } });
  });

  it("treats a cached answer that no longer fits the schema as a miss", async () => {
    const inner = live();
    const cache = new MemoryCache();
    const llm = createCachedLlm(inner, cache);
    await llm.complete(request);
    for (const entry of cache.entries.values()) entry.output = { renamed: true };

    const response = await llm.complete(request);

    expect(inner.calls).toBe(2);
    expect(response.cached).toBe(false);
  });
});
