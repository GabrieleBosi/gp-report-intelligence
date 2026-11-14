import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import execute from "../../netlify/functions/run-pipeline-background.ts";
import { ROOT } from "../support/dev-corpus.ts";

// Functions that accept a POST but change nothing a person relies on (each with its reason).
const UNGUARDED = {
  "health.ts": "read-only status report",
  "ping-background.ts": "writes one log line (proves background invocation, ADR-0002)",
  "keep-alive.ts": "scheduled: no URL, cannot be requested",
};

describe("the cross-site request guard is wired into every state-changing function (ship review 2026-10-12)", () => {
  it("every function that accepts POST calls refuseForeignRequest, or is a listed, harmless exception", () => {
    const dir = path.join(ROOT, "netlify/functions");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), "utf8");
      const methods = source.match(/export const config[^;]*method:\s*(\[[^\]]*\]|"[^"]*")/s)?.[1]; // ["GET", "POST"] or "GET"
      const acceptsPost = methods === undefined || methods.includes('"POST"'); // no method list = every method
      if (!acceptsPost || file in UNGUARDED) continue;
      expect(source, `${file} accepts POST but never calls the guard`).toMatch(/refuseForeignRequest\(req\.headers/);
    }
    for (const file of Object.keys(UNGUARDED)) expect(files, `stale exception ${file}`).toContain(file);
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("/execute refuses a cross-site request before it reads any configuration but the access key, or touches the database", async () => {
    const key = "k".repeat(32); // a valid owner key, so the request gets past withAccess to the guard (tests/netlify/access-wiring.test.ts)
    const get = vi.fn((name: string) => (name === "LIVE_ACCESS_KEY" ? key : undefined));
    vi.stubGlobal("Netlify", { env: { get } });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = new Request("http://localhost/api/runs/x/execute", {
      method: "POST", headers: { "sec-fetch-site": "cross-site", authorization: `Bearer ${key}` },
    });

    await execute(request, { params: { id: "00000000-0000-4000-8000-000000000000" } } as never);

    expect(get.mock.calls).toEqual([["LIVE_ACCESS_KEY"]]);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ level: "warn", fn: "run-pipeline", msg: "refused a request from another site" });
  });
});
