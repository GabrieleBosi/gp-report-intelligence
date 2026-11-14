import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_IMAGES_BUCKET } from "./supabase.ts";

// Rendered pages in the private page-images bucket, shared by the pipeline and the review screen.
export function createPageImageCache(db: SupabaseClient) {
  return {
    async read(path: string): Promise<Buffer | null> {
      const { data } = await db.storage.from(PAGE_IMAGES_BUCKET).download(path);
      return data ? Buffer.from(await data.arrayBuffer()) : null;
    },
    async write(path: string, png: Buffer): Promise<void> {
      const { error } = await db.storage.from(PAGE_IMAGES_BUCKET).upload(path, png, { contentType: "image/png", upsert: true });
      if (error) console.error(JSON.stringify({ level: "warn", msg: `page cache write failed: ${error.message}` }));
    },
  };
}
