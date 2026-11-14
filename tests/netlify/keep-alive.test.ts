import { afterEach, describe, expect, it, vi } from "vitest";
import keepAlive, { config } from "../../netlify/functions/keep-alive.ts";

describe("keep-alive (the free Supabase plan pauses after 7 days without activity)", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("runs every day at 06:00 UTC (08:00 in Zurich in summer), has no URL, and is not a background function", () => {
    expect(config).toEqual({ schedule: "0 6 * * *" });
  });

  it("touches the database and storage and logs the outcome; a failure is logged, never thrown", async () => {
    vi.stubGlobal("Netlify", { env: { get: () => undefined } }); // no credentials: both probes fail
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(keepAlive(new Request("http://localhost/", { method: "POST", body: JSON.stringify({ next_run: "2026-10-12T06:00:00Z" }) })))
      .resolves.toBeUndefined();
    const line = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "warn", fn: "keep-alive", status: "degraded", checks: { db: "fail", storage: "fail" }, next_run: "2026-10-12T06:00:00Z" });
  });
});
