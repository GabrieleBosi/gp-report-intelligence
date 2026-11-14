// USD per million tokens, Anthropic first-party rates (claude-api reference, cached 2026-10-06).
// Cache writes (5-minute TTL) cost 1.25x input. An unknown model throws: recording $0 would silently defeat the budget.
type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number };

const RATES: Record<string, Rates> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  // Possible server-side refusal fallback target (fallbacks: "default").
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export function costUsd(model: string, usage: TokenUsage): number {
  const rates = RATES[model];
  if (!rates) throw new Error(`unknown model "${model}": add its rates to core/pricing.ts`);
  return (usage.inputTokens * rates.input + usage.outputTokens * rates.output +
    usage.cacheReadTokens * rates.cacheRead + usage.cacheWriteTokens * rates.cacheWrite) / 1_000_000;
}
