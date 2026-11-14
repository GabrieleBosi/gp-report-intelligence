// Response cache (llm_cache table). Wraps the budget-guarded client from the outside: a hit never reaches the model,
// the budget or the usage ledger, so re-running a document is instant and free. Keyed by cacheKey(), so a new prompt
// version, model, effort or input is always a miss.
import { cacheKey, type LlmClient, type LlmUsage } from "./llm.ts";

export type CachedResponse = { prompt: string; model: string; output: unknown; usage: LlmUsage };

export interface LlmCache {
  get(key: string): Promise<CachedResponse | null>;
  put(key: string, entry: CachedResponse): Promise<void>;
}

const FREE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };

export function createCachedLlm(inner: LlmClient, cache: LlmCache): LlmClient {
  return {
    async complete(request) {
      const key = await cacheKey(request);
      const hit = await cache.get(key);
      const parsed = hit ? request.schema.safeParse(hit.output) : null;
      if (hit && parsed?.success) {
        return { output: parsed.data, cacheKey: key, cached: true, usage: { model: hit.model, ...FREE } };
      }
      const response = await inner.complete(request);
      await cache.put(key, {
        prompt: `${request.prompt.id}@${request.prompt.version}`, model: response.usage.model, output: response.output, usage: response.usage,
      });
      return { ...response, cacheKey: key, cached: false };
    },
  };
}
