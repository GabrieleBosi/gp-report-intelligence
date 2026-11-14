import type { SupabaseClient } from "@supabase/supabase-js";
import type { CachedResponse, LlmCache } from "../../core/llm-cache.ts";

export function createSupabaseLlmCache(db: SupabaseClient): LlmCache {
  return {
    async get(key) {
      const { data, error } = await db.from("llm_cache").select("prompt, model, output, usage").eq("key", key).maybeSingle();
      if (error) throw new Error(`read llm cache: ${error.message}`);
      return data as CachedResponse | null;
    },
    async put(key, entry) {
      // upsert: two runs of the same document can race to store the same answer.
      const { error } = await db.from("llm_cache").upsert({ key, ...entry });
      if (error) throw new Error(`write llm cache: ${error.message}`);
    },
  };
}
