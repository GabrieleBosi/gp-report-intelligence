import { describe, expect, it } from "vitest";
import { requestRun, STALE_AFTER_MINUTES, type RunRequestDeps } from "../../core/run-request.ts";
import { ok, err } from "../../core/result.ts";

function deps(over: Partial<RunRequestDeps> = {}): RunRequestDeps & { created: string[]; expired: string[] } {
  const d = {
    created: [] as string[], expired: [] as string[], budgetUsd: 15,
    async expireStale(documentId: string) { d.expired.push(documentId); return 0; },
    async documentExists() { return true; },
    async spentTodayUsd() { return 2.5; },
    async create(documentId: string) { d.created.push(documentId); return ok({ runId: "run-1" }); },
    ...over,
  };
  return d as RunRequestDeps & { created: string[]; expired: string[] };
}

describe("requestRun (POST /api/runs)", () => {
  it("creates a queued run when the document exists and today's budget is not used up", async () => {
    const d = deps();

    expect(await requestRun(d, "doc-1")).toEqual({ status: 201, body: { run_id: "run-1" } });
    expect(d.created).toEqual(["doc-1"]);
  });

  it("refuses the run before any LLM call once today's spend reaches the budget, with the message the UI shows", async () => {
    const d = deps({ spentTodayUsd: async () => 15.02 });

    expect(await requestRun(d, "doc-1")).toEqual({ status: 429, body: {
      error: "Today's AI budget of $15.00 is used up ($15.02 spent). Runs are possible again tomorrow (UTC).", code: "budget_exceeded",
    } });
    expect(d.created).toEqual([]);
  });

  it("answers 404 for an unknown document and 409 when a run is already active", async () => {
    expect(await requestRun(deps({ documentExists: async () => false }), "doc-x")).toMatchObject({ status: 404 });
    expect(await requestRun(deps({ create: async () => err("conflict", "A run for this document is already in progress.") }), "doc-1"))
      .toEqual({ status: 409, body: { error: "A run for this document is already in progress." } });
  });

  it("first expires the document's dead runs, so a crashed run cannot block its document forever (security audit finding 2)", async () => {
    const calls: string[] = [];
    const d = deps({
      async expireStale(documentId) { calls.push(`expire ${documentId}`); return 1; },
      async create(documentId) { calls.push(`create ${documentId}`); return ok({ runId: "run-2" }); },
    });

    expect(await requestRun(d, "doc-1")).toEqual({ status: 201, body: { run_id: "run-2" } });
    expect(calls).toEqual(["expire doc-1", "create doc-1"]);
  });

  it("creates nothing when expiring stale runs fails: the error reaches the function, which answers 500", async () => {
    const d = deps({ async expireStale() { throw new Error("expire queued runs: connection reset"); } });

    await expect(requestRun(d, "doc-1")).rejects.toThrow("connection reset");
    expect(d.created).toEqual([]);
  });

  it("calls a run dead only when no live function can still own it: queued 5 minutes, running past the 15-minute limit", () => {
    expect(STALE_AFTER_MINUTES).toEqual({ queued: 5, running: 16 });
  });
});
