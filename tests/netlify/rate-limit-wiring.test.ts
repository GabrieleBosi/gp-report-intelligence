import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/dev-corpus.ts";

// SPEC-public-release W2: per-IP limits, applied by Netlify before a function runs. The Pro plan allows 5 code-based
// rules per project; with 11 declared, none was enforced on the live site (checked 2026-11-15). So the 5 go where a
// leaked key would cost money or write: pipeline runs and uploads (tight), creating runs, review decisions and posting.
const dir = path.join(ROOT, "netlify/functions");
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
const MAX_RULES = 5;
const COSTLY = ["upload.ts", "run-pipeline-background.ts"];
const WRITES = ["runs.ts", "review.ts", "post.ts"];
const configOf = async (file: string) => (await import(path.join(dir, file)) as { config: { rateLimit?: unknown } }).config;

describe("per-IP rate limits", () => {
  it(`stays within the plan's ${MAX_RULES} code-based rules, all on the paths that cost money or write`, async () => {
    const limited: string[] = [];
    for (const file of files) if ((await configOf(file)).rateLimit) limited.push(file);
    expect(limited.sort()).toEqual([...COSTLY, ...WRITES].sort());
    expect(limited.length).toBeLessThanOrEqual(MAX_RULES);
  });

  it.each(COSTLY)("%s: 10 per IP in 3 minutes", async (file) => {
    expect((await configOf(file)).rateLimit).toEqual({ action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 180, windowLimit: 10 });
  });

  it.each(WRITES)("%s: 60 per IP a minute", async (file) => {
    expect((await configOf(file)).rateLimit).toEqual({ action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 });
  });
});
