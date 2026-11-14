import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { cacheKey, LlmError, type LlmClient, type LlmRequest, type LlmResponse } from "../../core/llm.ts";
import type { CachedResponse, LlmCache } from "../../core/llm-cache.ts";
import { createAnthropicLlm, type MessagesParse } from "../../netlify/lib/anthropic-llm.ts";
import { createRecordingLlm, createReplayLlm, createReplayOrCacheLlm } from "../../netlify/lib/replay-llm.ts";

const Schema = z.object({ fund_name: z.string() });
const request: LlmRequest<z.infer<typeof Schema>> = {
  step: "classify", prompt: { id: "classify", version: 1 }, model: "claude-opus-5-5", effort: "low",
  system: "Classify.", text: "<document>Alpenrose Buyout IV</document>", schema: Schema,
  images: [{ mediaType: "image/png", base64: "iVBORw0KGgo=" }],
};

function fakeParse(response: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const parse = (async (params: Record<string, unknown>) => { calls.push(params); return response; }) as unknown as MessagesParse;
  return { parse, calls };
}
const usage = { input_tokens: 1_000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

describe("createAnthropicLlm", () => {
  it("returns the parsed output and prices the call by the model that answered", async () => {
    const { parse } = fakeParse({ model: "claude-opus-5-5", stop_reason: "end_turn", parsed_output: { fund_name: "Alpenrose Buyout IV" }, usage });

    const result = await createAnthropicLlm(parse).complete(request);

    expect(result.output).toEqual({ fund_name: "Alpenrose Buyout IV" });
    expect(result.usage).toMatchObject({ model: "claude-opus-5-5", inputTokens: 1_000, outputTokens: 200 });
    expect(result.usage.costUsd).toBeCloseTo((1_000 * 4 + 200 * 20) / 1e6, 10);
  });

  it("sends effort, a schema-constrained format, the default refusal fallback, and images before text", async () => {
    const { parse, calls } = fakeParse({ model: "claude-opus-5-5", stop_reason: "end_turn", parsed_output: { fund_name: "x" }, usage });

    await createAnthropicLlm(parse).complete(request);

    const params = calls[0] as { betas: string[]; fallbacks: string; output_config: { effort: string; format: unknown }; messages: { content: { type: string }[] }[] };
    expect(params.betas).toContain("server-side-fallback-2026-07-01");
    expect(params.fallbacks).toBe("default");
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format).toBeDefined();
    expect(params.messages[0]?.content.map((c) => c.type)).toEqual(["image", "text"]);
  });

  it.each([
    [{ stop_reason: "refusal", stop_details: { category: "cyber" }, parsed_output: null }, "refusal"],
    [{ stop_reason: "max_tokens", parsed_output: null }, "truncated"],
    [{ stop_reason: "end_turn", parsed_output: null }, "invalid_output"],
  ])("turns %o into a typed %s error", async (response, code) => {
    const { parse } = fakeParse({ model: "claude-opus-5-5", usage, ...response });

    await expect(createAnthropicLlm(parse).complete(request)).rejects.toMatchObject({ code });
  });
});

describe("record and replay", () => {
  const dirs: string[] = [];
  afterAll(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
  const fixturesDir = async () => { const d = await mkdtemp(path.join(tmpdir(), "llm-fixtures-")); dirs.push(d); return d; };
  const countingLlm = (): LlmClient & { calls: number } => ({
    calls: 0,
    async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
      this.calls++;
      return { output: req.schema.parse({ fund_name: "Alpenrose Buyout IV" }), cacheKey: "",
        usage: { model: req.model, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.001 } };
    },
  });

  it("replays a recorded response without calling the model", async () => {
    const dir = await fixturesDir();
    await createRecordingLlm(countingLlm(), dir).complete(request);

    const replayed = await createReplayLlm(dir).complete(request);

    expect(replayed.output).toEqual({ fund_name: "Alpenrose Buyout IV" });
    expect(await readdir(dir)).toHaveLength(1);
  });

  it("fails a replay miss loudly, naming the prompt version", async () => {
    const dir = await fixturesDir();

    await expect(createReplayLlm(dir).complete(request)).rejects.toThrow(/classify@1/);
  });

  it("rejects a recorded response that no longer matches the current schema", async () => {
    const dir = await fixturesDir();
    await createRecordingLlm(countingLlm(), dir).complete(request);
    const [file] = await readdir(dir);
    const fixture = JSON.parse(await readFile(path.join(dir, file ?? ""), "utf8"));
    fixture.output = { fund: "renamed field" };
    await writeFile(path.join(dir, file ?? ""), JSON.stringify(fixture));

    await expect(createReplayLlm(dir).complete(request)).rejects.toBeInstanceOf(LlmError);
  });
});

// SPEC-public-release T7: the held-out documents' answers are copied from the live cache (llm_cache) into fixtures.
// No model client exists on this path, so it cannot spend: a key in neither place fails and is reported.
describe("createReplayOrCacheLlm", () => {
  const dirs: string[] = [];
  afterAll(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
  const fixturesDir = async () => { const d = await mkdtemp(path.join(tmpdir(), "llm-fixtures-")); dirs.push(d); return d; };
  const cached: CachedResponse = {
    prompt: "classify@1", model: "claude-opus-5-5", output: { fund_name: "Alpenrose Buyout IV" },
    usage: { model: "claude-opus-5-5", inputTokens: 900, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.02 },
  };
  const memoryCache = (entries: Record<string, CachedResponse>): LlmCache & { reads: string[] } => ({
    reads: [],
    async get(key) { this.reads.push(key); return entries[key] ?? null; },
    async put() { throw new Error("the export only reads the cache"); },
  });

  it("copies an answer that is only in the cache into a fixture that plain replay then serves", async () => {
    const dir = await fixturesDir();
    const cache = memoryCache({ [await cacheKey(request)]: cached });

    const result = await createReplayOrCacheLlm(cache, dir).complete(request);

    expect(result.output).toEqual({ fund_name: "Alpenrose Buyout IV" });
    expect(result.usage.costUsd).toBe(0.02); // the recorded cost, as replay reports it
    expect((await createReplayLlm(dir).complete(request)).output).toEqual({ fund_name: "Alpenrose Buyout IV" });
    const [file] = await readdir(dir);
    expect(JSON.parse(await readFile(path.join(dir, file ?? ""), "utf8"))).toMatchObject({ prompt: "classify@1", model: "claude-opus-5-5", effort: "low" });
  });

  it("serves an existing fixture without reading the cache", async () => {
    const dir = await fixturesDir();
    await createRecordingLlm(countingLlmFor(), dir).complete(request);
    const cache = memoryCache({});

    await createReplayOrCacheLlm(cache, dir).complete(request);

    expect(cache.reads).toEqual([]);
  });

  it("fails a key that is in neither place as a replay miss, and writes nothing", async () => {
    const dir = await fixturesDir();

    await expect(createReplayOrCacheLlm(memoryCache({}), dir).complete(request)).rejects.toMatchObject({ code: "replay_miss" });
    expect(await readdir(dir)).toEqual([]);
  });

  it("rejects a cached answer that does not match the current schema, and writes nothing", async () => {
    const dir = await fixturesDir();
    const cache = memoryCache({ [await cacheKey(request)]: { ...cached, output: { fund: "renamed field" } } });

    await expect(createReplayOrCacheLlm(cache, dir).complete(request)).rejects.toMatchObject({ code: "invalid_output" });
    expect(await readdir(dir)).toEqual([]);
  });
});

function countingLlmFor(): LlmClient {
  return {
    async complete<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
      return { output: req.schema.parse({ fund_name: "Alpenrose Buyout IV" }), cacheKey: "",
        usage: { model: req.model, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.001 } };
    },
  };
}
