import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseRunStore } from "../../netlify/lib/run-store.ts";

// A recording stand-in for the Supabase query builder: each from() call records its chain and answers in turn.
function recordingDb(answers: { data: { id: string }[] | null; error: { message: string } | null }[]) {
  const queries: { table: string; calls: [string, ...unknown[]][] }[] = [];
  const db = {
    from(table: string) {
      const query = { table, calls: [] as [string, ...unknown[]][] };
      queries.push(query);
      const answer = answers[queries.length - 1] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ["update", "eq", "lt", "select"]) {
        chain[method] = (...args: unknown[]) => { query.calls.push([method, ...args]); return method === "select" ? Promise.resolve(answer) : chain; };
      }
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, queries };
}

const NOW = new Date("2026-10-13T08:00:00.000Z");

describe("expireStale against the database (ship review 2026-10-12: the query itself was untested)", () => {
  it("fails the document's runs queued for over 5 minutes and running for over 16, with the reason, and counts them", async () => {
    const { db, queries } = recordingDb([{ data: [{ id: "q1" }, { id: "q2" }], error: null }, { data: [{ id: "r1" }], error: null }]);

    expect(await createSupabaseRunStore(db).expireStale("doc-1", NOW)).toBe(3);
    expect(queries.map((q) => q.table)).toEqual(["pipeline_runs", "pipeline_runs"]);
    const [queued, running] = queries.map((q) => q.calls);
    expect(queued).toEqual([
      ["update", { status: "failed", finished_at: "2026-10-13T08:00:00.000Z",
        error: "abandoned: still queued after 5 minutes (the run's function never finished); expired when a new run was requested" }],
      ["eq", "document_id", "doc-1"], ["eq", "status", "queued"], ["lt", "created_at", "2026-10-13T07:55:00.000Z"], ["select", "id"],
    ]);
    expect(running?.slice(1)).toEqual([
      ["eq", "document_id", "doc-1"], ["eq", "status", "running"], ["lt", "started_at", "2026-10-13T07:44:00.000Z"], ["select", "id"],
    ]);
  });

  it("raises a database error instead of pretending nothing was stale", async () => {
    const { db } = recordingDb([{ data: null, error: { message: "connection reset" } }]);
    await expect(createSupabaseRunStore(db).expireStale("doc-1", NOW)).rejects.toThrow("expire queued runs: connection reset");
  });
});
