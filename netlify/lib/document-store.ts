import type { SupabaseClient } from "@supabase/supabase-js";
import { DocumentRecord, type DocumentStore } from "../../core/documents.ts";
import { RAW_REPORTS_BUCKET } from "./supabase.ts";

const COLUMNS = "id, sha256, filename, mime, size_bytes, storage_path, source, corpus_meta, created_at";

// Supabase implementation of the DocumentStore port. Rows are validated on the way out, so a schema drift fails
// loudly here instead of reaching the UI or the pipeline.
export function createSupabaseDocumentStore(db: SupabaseClient): DocumentStore {
  const fail = (what: string, error: { message: string }) => new Error(`${what}: ${error.message}`);
  return {
    async findBySha256(sha256) {
      const { data, error } = await db.from("documents").select(COLUMNS).eq("sha256", sha256).maybeSingle();
      if (error) throw fail("find document", error);
      return data ? DocumentRecord.parse(data) : null;
    },
    async putFile(path, bytes, mime) {
      // Content-addressed paths make an overwrite a no-op, so retries are safe.
      const { error } = await db.storage.from(RAW_REPORTS_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
      if (error) throw fail("store file", error);
    },
    async insert(doc) {
      const { data, error } = await db.from("documents").insert(doc).select(COLUMNS).single();
      if (error) throw fail("insert document", error);
      return DocumentRecord.parse(data);
    },
    async appendAudit(event) {
      const { error } = await db.from("audit_events").insert(event);
      if (error) throw fail("append audit event", error);
    },
    async list() {
      const { data, error } = await db.from("documents").select(COLUMNS).order("created_at");
      if (error) throw fail("list documents", error);
      return data.map((row) => DocumentRecord.parse(row));
    },
  };
}
