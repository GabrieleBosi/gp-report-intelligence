// Live LlmClient on the Anthropic SDK (claude-api reference): structured outputs via betaZodOutputFormat, effort set
// explicitly (Opus 5.5 defaults to medium and thinking cannot be disabled), and the server-side refusal fallback
// (fallbacks: "default") so a classifier decline is rerouted instead of failing the run.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { cacheKey, LlmError, type LlmClient } from "../../core/llm.ts";
import { costUsd } from "../../core/pricing.ts";

export type MessagesParse = Anthropic["beta"]["messages"]["parse"];

const MAX_TOKENS = 16_000; // non-streaming default; section outputs are a few thousand tokens at most

export function createAnthropicLlm(parse: MessagesParse): LlmClient {
  return {
    async complete(request) {
      const response = await parse({
        model: request.model,
        max_tokens: MAX_TOKENS,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: request.effort, format: betaZodOutputFormat(request.schema) },
        system: request.system,
        messages: [{
          role: "user",
          content: [
            ...(request.images ?? []).map((image) => ({
              type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 },
            })),
            { type: "text" as const, text: request.text },
          ],
        }],
      });

      const where = `${request.prompt.id}@${request.prompt.version}`;
      if (response.stop_reason === "refusal") {
        throw new LlmError("refusal", `${where}: the model declined (${response.stop_details?.category ?? "no category"})`);
      }
      if (response.stop_reason === "max_tokens") throw new LlmError("truncated", `${where}: output hit ${MAX_TOKENS} tokens`);
      if (response.parsed_output == null) throw new LlmError("invalid_output", `${where}: output did not match the schema`);

      const tokens = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
      return {
        output: response.parsed_output,
        usage: { model: response.model, ...tokens, costUsd: costUsd(response.model, tokens) },
        cacheKey: await cacheKey(request),
      };
    },
  };
}

export function anthropicFromEnv(apiKey: string | undefined): LlmClient {
  if (!apiKey?.trim()) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });
  return createAnthropicLlm(client.beta.messages.parse.bind(client.beta.messages));
}
