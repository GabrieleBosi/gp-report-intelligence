import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createAdminClient, supabaseProbes } from "../../netlify/lib/supabase.ts";

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
