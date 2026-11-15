import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { allRows, createAdminClient, supabaseProbes } from "../../netlify/lib/supabase.ts";

// Minimal stand-in for the two calls the probes make; anything else would throw.
function fakeClient({ dbError = null, bucketError = null }: { dbError?: unknown; bucketError?: unknown }) {
  return {
    from: () => ({ select: async () => ({ error: dbError }) }),
    storage: { getBucket: async () => ({ error: bucketError }) },
  } as unknown as SupabaseClient;
}

describe("createAdminClient", () => {
  it("returns null when the URL or key is missing", () => {
    expect(createAdminClient({ SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
    expect(createAdminClient({ SUPABASE_SERVICE_ROLE_KEY: "k" })).toBeNull();
  });

  it("builds a client when both are present", () => {
    const client = createAdminClient({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" });
    expect(client).not.toBeNull();
  });
});

describe("supabaseProbes", () => {
  it("fails both checks when there is no client", async () => {
    const probes = supabaseProbes(null);
    expect([await probes.db(), await probes.storage()]).toEqual([false, false]);
  });

  it("passes both checks when the table and bucket respond", async () => {
    const probes = supabaseProbes(fakeClient({}));
    expect([await probes.db(), await probes.storage()]).toEqual([true, true]);
  });

  it("fails the db check on a query error", async () => {
    const probes = supabaseProbes(fakeClient({ dbError: { message: "relation does not exist" } }));
    expect(await probes.db()).toBe(false);
  });

  it("fails the storage check when the bucket is missing", async () => {
    const probes = supabaseProbes(fakeClient({ bucketError: { message: "Bucket not found" } }));
    expect(await probes.storage()).toBe(false);
  });
});

// A table of n rows, read the way PostgREST pages it; records each query.
function tableClient(n: number, error: { message: string } | null = null) {
  const queries: { table: string; columns: string; order: string; from: number; to: number }[] = [];
  const client = {
    from: (table: string) => ({ select: (columns: string) => ({ order: (order: string) => ({ range: async (from: number, to: number) => {
      queries.push({ table, columns, order, from, to });
      return error ? { data: null, error } : { data: Array.from({ length: Math.max(0, Math.min(n, to + 1) - from) }, (_, i) => ({ i: from + i })), error: null };
    } }) }) }),
  } as unknown as SupabaseClient;
  return { client, queries };
}

describe("allRows: every row of a table, past PostgREST's 1,000-row page", () => {
  it("reads page after page until a short one, in a stable order", async () => {
    const { client, queries } = tableClient(2_345);
    const rows = await allRows<{ i: number }>(client, "usage_ledger", "cost_usd, created_at", "created_at");
    expect(rows.map((r) => r.i)).toEqual(Array.from({ length: 2_345 }, (_, i) => i));
    expect(queries.map((q) => [q.from, q.to])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(queries.every((q) => q.table === "usage_ledger" && q.columns === "cost_usd, created_at" && q.order === "created_at")).toBe(true);
  });

  it("orders by id unless told otherwise, and names the table when a query fails", async () => {
    const { client, queries } = tableClient(3);
    await allRows(client, "documents", "id");
    expect(queries[0]?.order).toBe("id");
    await expect(allRows(tableClient(0, { message: "boom" }).client, "documents", "id")).rejects.toThrow("documents: boom");
  });
});
