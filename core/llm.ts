// The LlmClient port (ADR-0001): pipeline steps depend on this, never on the SDK. Implementations: Anthropic (live),
// replay (recorded fixtures, used in CI) and record (live + write fixture), in netlify/lib.
import type { z } from "zod";
import { sha256Hex } from "./hash.ts";
import type { TokenUsage } from "./pricing.ts";

export type Effort = "low" | "medium" | "high";
// id: a stable identity for the image (e.g. "<doc sha256>#p1@130/pdfjs@6.4.299"). When present it keys the cache
// instead of the pixels, because the same page rendered on another machine is not byte-identical.
export type LlmImage = { mediaType: "image/png"; base64: string; id?: string };

export type LlmRequest<T> = {
  step: string; // pipeline step, for the usage ledger and audit trail
  prompt: { id: string; version: number };
  model: string;
  effort: Effort;
  system: string;
  text: string; // user content; document text is wrapped in delimiting tags by the prompt builder
  images?: LlmImage[];
  schema: z.ZodType<T>;
};

export type LlmUsage = TokenUsage & { model: string; costUsd: number }; // model = the one that answered (may be a fallback)
export type LlmResponse<T> = { output: T; usage: LlmUsage; cacheKey: string; cached?: boolean }; // cached: served from llm_cache, $0

export interface LlmClient {
  complete<T>(request: LlmRequest<T>): Promise<LlmResponse<T>>;
}

export type LlmErrorCode = "refusal" | "truncated" | "invalid_output" | "budget_exceeded" | "replay_miss";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
  }
}

// Everything that can change the answer is in the key, so a new prompt version, model or input never replays a
// stale response. The schema is identified through the prompt version, which must be bumped when it changes.
export async function cacheKey(request: LlmRequest<unknown>): Promise<string> {
  const images = await Promise.all((request.images ?? []).map((i) => i.id ?? sha256Hex(i.base64)));
  return sha256Hex(JSON.stringify([
    request.model, `${request.prompt.id}@${request.prompt.version}`, request.effort, request.system, request.text, images,
  ]));
}

// Shadow experiments (SPEC-evals): run one step on a candidate model. Applied before caching/recording, so the
// candidate's answers get their own cache keys (the model is part of the key).
export function withStepModel(inner: LlmClient, step: string, model: string): LlmClient {
  return { complete: (request) => inner.complete(request.step === step ? { ...request, model } : request) };
}

// A hard cap for one experiment, on top of the daily budget: refuses the next live call once the spend so far plus the
// last call's cost would exceed it (the next call is expected to cost about as much as the last one).
export function withSpendCap(inner: LlmClient, capUsd: number): LlmClient & { spentUsd(): number } {
  let spent = 0;
  let last = 0;
  return {
    spentUsd: () => spent,
    async complete(request) {
      if (spent + last > capUsd) {
        throw new LlmError("budget_exceeded", `Experiment spend cap of $${capUsd.toFixed(2)} reached ($${spent.toFixed(2)} spent).`);
      }
      const response = await inner.complete(request);
      if (!response.cached) { spent += response.usage.costUsd; last = response.usage.costUsd; }
      return response;
    },
  };
}
