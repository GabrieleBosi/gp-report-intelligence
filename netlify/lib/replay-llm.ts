// Record/replay LlmClients: CI and repeated eval runs replay recorded responses at zero cost; recording is an
// explicit, budgeted step. A fixture is keyed by cacheKey(), so any change to prompt version, model, effort or input
// is a visible miss, never a stale answer.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { cacheKey, LlmError, type LlmClient, type LlmUsage } from "../../core/llm.ts";
import type { LlmCache } from "../../core/llm-cache.ts";

type Fixture = { prompt: string; model: string; effort: string; output: unknown; usage: LlmUsage };

export function createReplayLlm(fixturesDir: string): LlmClient {
  return {
    async complete(request) {
      const key = await cacheKey(request);
      const where = `${request.prompt.id}@${request.prompt.version}`;
      let fixture: Fixture;
      try {
        fixture = JSON.parse(await readFile(path.join(fixturesDir, `${key}.json`), "utf8")) as Fixture;
      } catch {
        throw new LlmError("replay_miss", `no recorded response for ${where} (key ${key.slice(0, 12)}): record it with: node scripts/record-fixtures.ts ${request.step}`);
      }
      // Re-validate: a schema change without a prompt-version bump must fail here, not downstream.
      const parsed = request.schema.safeParse(fixture.output);
      if (!parsed.success) throw new LlmError("invalid_output", `${where}: recorded output no longer matches the schema`);
      return { output: parsed.data, usage: fixture.usage, cacheKey: key };
    },
  };
}

export function createRecordingLlm(inner: LlmClient, fixturesDir: string): LlmClient {
  return {
    async complete(request) {
      const response = await inner.complete(request);
      const key = await cacheKey(request);
      const fixture: Fixture = {
        prompt: `${request.prompt.id}@${request.prompt.version}`, model: request.model, effort: request.effort,
        output: response.output, usage: response.usage,
      };
      await mkdir(fixturesDir, { recursive: true });
      await writeFile(path.join(fixturesDir, `${key}.json`), JSON.stringify(fixture, null, 2) + "\n");
      return { ...response, cacheKey: key };
    },
  };
}

// Replay what is recorded, record only what is missing: re-recording never pays twice for an unchanged request.
export function createReplayOrRecordLlm(live: LlmClient, fixturesDir: string): LlmClient {
  const replay = createReplayLlm(fixturesDir);
  const record = createRecordingLlm(live, fixturesDir);
  return {
    async complete(request) {
      try {
        return { ...(await replay.complete(request)), cached: true };
      } catch (error) {
        if (error instanceof LlmError && error.code === "replay_miss") return record.complete(request);
        throw error;
      }
    },
  };
}

// Replay what is recorded; copy a missing answer from the live response cache (llm_cache) into a fixture. Used once to
// bring the held-out split's answers into the repository (SPEC-public-release T7). It holds no model client, so it can
// never spend: an answer in neither place is a replay miss, to be recorded only after asking.
export function createReplayOrCacheLlm(cache: LlmCache, fixturesDir: string): LlmClient {
  const replay = createReplayLlm(fixturesDir);
  return {
    async complete(request) {
      try {
        return await replay.complete(request);
      } catch (error) {
        if (!(error instanceof LlmError && error.code === "replay_miss")) throw error;
      }
      const key = await cacheKey(request);
      const where = `${request.prompt.id}@${request.prompt.version}`;
      const entry = await cache.get(key);
      if (!entry) throw new LlmError("replay_miss", `${where} (key ${key.slice(0, 12)}) is neither recorded nor in llm_cache`);
      const parsed = request.schema.safeParse(entry.output);
      if (!parsed.success) throw new LlmError("invalid_output", `${where}: the cached output does not match the current schema`);
      const fixture: Fixture = { prompt: entry.prompt, model: entry.model, effort: request.effort, output: entry.output, usage: entry.usage };
      await mkdir(fixturesDir, { recursive: true });
      await writeFile(path.join(fixturesDir, `${key}.json`), JSON.stringify(fixture, null, 2) + "\n");
      return { output: parsed.data, usage: entry.usage, cacheKey: key };
    },
  };
}
