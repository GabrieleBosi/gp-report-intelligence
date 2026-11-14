import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLiveKey } from "../../src/lib/access.ts";
import { fetchRun, pollDelayMs, startRun } from "../../src/lib/api.ts";

type Call = { url: string; method: string; body?: string };

function stubFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

// These cover the live API; the snapshot mode is covered in api-modes.test.ts.
beforeEach(() => setLiveKey("k".repeat(32)));
afterEach(() => { vi.unstubAllGlobals(); setLiveKey(null); });

const RUN_ID = "3b9d5231-2e31-491b-b789-1df8d8168c80";
const view = (status: string) => ({
  run: { id: RUN_ID, document_id: "2e27075d-fdbb-4d1e-b71d-4a4cff95369a", status, pipeline_version: "pipeline@0.1.0", error: null,
    created_at: "2026-10-11T06:19:27Z", started_at: null, finished_at: null },
  document: { filename: "alpenrose-iv-2026q2.pdf" },
  extraction: null,
  assessment: null,
  steps: [],
});

describe("startRun", () => {
  it("surfaces the budget refusal and never starts the run", async () => {
    const calls = stubFetch([{ status: 429, body: { error: "Today's AI budget of $15.00 is used up ($15.02 spent). Runs are possible again tomorrow (UTC).", code: "budget_exceeded" } }]);

    await expect(startRun("2e27075d-fdbb-4d1e-b71d-4a4cff95369a")).rejects.toThrow(/AI budget of \$15\.00 is used up/);
    expect(calls.map((c) => c.url)).toEqual(["/api/runs"]);
  });

  it("creates a run and then starts it, returning the run id", async () => {
    const calls = stubFetch([{ status: 201, body: { run_id: RUN_ID } }, { status: 202, body: {} }]);

    expect(await startRun("doc-1")).toBe(RUN_ID);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/runs", `POST /api/runs/${RUN_ID}/execute`]);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ document_id: "doc-1" });
  });

  it("surfaces the server's reason when a run is already in progress", async () => {
    stubFetch([{ status: 409, body: { error: "This document already has a run in progress." } }]);

    await expect(startRun("doc-1")).rejects.toThrow("This document already has a run in progress.");
  });
});

describe("fetchRun", () => {
  it("returns a validated run view", async () => {
    stubFetch([{ status: 200, body: view("running") }]);

    expect((await fetchRun(RUN_ID)).run.status).toBe("running");
  });

  it("rejects a response that breaks the contract instead of rendering garbage", async () => {
    stubFetch([{ status: 200, body: { run: { id: RUN_ID } } }]);

    await expect(fetchRun(RUN_ID)).rejects.toThrow();
  });

  it("reports a missing run clearly", async () => {
    stubFetch([{ status: 404, body: { error: "Run not found." } }]);

    await expect(fetchRun(RUN_ID)).rejects.toThrow("Run not found.");
  });
});

describe("pollDelayMs", () => {
  it.each([["queued", 1500], ["running", 1500], ["extracted", null], ["failed", null], ["needs_review", null]])(
    "%s -> %s", (status, delay) => expect(pollDelayMs(status as never)).toBe(delay));
});
