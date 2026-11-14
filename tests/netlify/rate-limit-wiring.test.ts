import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/dev-corpus.ts";

// SPEC-public-release W2: per-IP limits, applied by Netlify before a function runs. Every function with a URL has one,
// since even a refused request is an invocation; the two that cost money when the owner's key leaks (a pipeline run
// calls the model; an upload stores a file and is followed by a run) are tighter.
const dir = path.join(ROOT, "netlify/functions");
const withPath = readdirSync(dir).filter((f) => f.endsWith(".ts"))
  .filter((f) => /export const config[^;]*\bpath:/s.test(readFileSync(path.join(dir, f), "utf8")));
const COSTLY = ["upload.ts", "run-pipeline-background.ts"];

describe("per-IP rate limits", () => {
  it("covers every function with a URL", () => {
    expect(withPath.length).toBeGreaterThanOrEqual(11);
    expect(withPath).toEqual(expect.arrayContaining(COSTLY));
  });

  it.each(withPath)("%s", async (file) => {
    const { config } = await import(path.join(dir, file)) as { config: { rateLimit?: unknown } };
    expect(config.rateLimit).toEqual(COSTLY.includes(file)
      ? { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 180, windowLimit: 10 }
      : { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 });
  });
});
