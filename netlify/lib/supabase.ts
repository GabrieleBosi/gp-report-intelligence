import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Probe } from "../../core/health.ts";

export const RAW_REPORTS_BUCKET = "raw-reports";
export const PAGE_IMAGES_BUCKET = "page-images";

// Server-only client with the service-role key. Never import this from src/ (ADR-0003).
export function createAdminClient(env: Record<string, string | undefined>): SupabaseClient | null {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function supabaseProbes(client: SupabaseClient | null): Record<"db" | "storage", Probe> {
  return {
    db: async () => {
      if (!client) return false;
      const { error } = await client.from("documents").select("id", { head: true, count: "exact" });
      return !error;
    },
    storage: async () => {
      if (!client) return false;
      const { error } = await client.storage.getBucket(RAW_REPORTS_BUCKET);
      return !error;
    },
  };
}
