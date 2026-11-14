// Step 1 (receive + store raw): one path for corpus seeding and live uploads. Files are content-addressed by
// SHA-256, so identical bytes are stored and audited once, whatever they are called.
import { z } from "zod";
import { sha256Hex } from "./hash.ts";

export { sha256Hex };

export const SPREADSHEET_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EXTENSION_BY_MIME: Record<string, string> = { "application/pdf": ".pdf", [SPREADSHEET_MIME]: ".xlsx" };

// Descriptive metadata for corpus documents only (shown in the UI). It must never hold expected values, and
// the pipeline must never read it: classification has to come from the document, or evals would be measuring leaked labels.
export const CorpusMeta = z.object({
  doc_id: z.string(),
  gp_name: z.string(),
  fund_name: z.string(),
  period_end: z.iso.date(),
  format: z.enum(["native_pdf", "scanned_pdf", "xlsx"]),
  split: z.enum(["dev", "heldout"]),
});

export const DocumentRecord = z.object({
  id: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  filename: z.string(),
  mime: z.string(),
  size_bytes: z.number().int().positive(),
  storage_path: z.string(),
  source: z.enum(["corpus", "upload"]),
  corpus_meta: CorpusMeta.nullable(),
  created_at: z.string(),
});

export type CorpusMeta = z.infer<typeof CorpusMeta>;
export type DocumentRecord = z.infer<typeof DocumentRecord>;
export type NewDocument = Omit<DocumentRecord, "id" | "created_at">;
export type AuditEventInput = {
  document_id: string;
  step: number;
  actor: "system" | "analyst" | `llm:${string}`;
  event: string;
  payload: Record<string, unknown>;
};

// Port implemented by netlify/lib/document-store.ts (Supabase) and by in-memory fakes in tests (ADR-0001).
export interface DocumentStore {
  findBySha256(sha256: string): Promise<DocumentRecord | null>;
  putFile(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  insert(doc: NewDocument): Promise<DocumentRecord>;
  appendAudit(event: AuditEventInput): Promise<void>;
  list(): Promise<DocumentRecord[]>;
}

export type DocumentInput = {
  filename: string;
  mime: string;
  bytes: Uint8Array;
  source: DocumentRecord["source"];
  corpus_meta?: CorpusMeta;
};


export async function registerDocument(store: DocumentStore, input: DocumentInput): Promise<{ document: DocumentRecord; created: boolean }> {
  const sha256 = await sha256Hex(input.bytes);
  const existing = await store.findBySha256(sha256);
  if (existing) return { document: existing, created: false };

  // File first, row second: a row never points at a missing file.
  const storage_path = `${input.source}/${sha256}${EXTENSION_BY_MIME[input.mime] ?? ""}`;
  await store.putFile(storage_path, input.bytes, input.mime);
  const document = await store.insert({
    sha256, filename: input.filename, mime: input.mime, size_bytes: input.bytes.byteLength,
    storage_path, source: input.source, corpus_meta: input.corpus_meta ?? null,
  });
  await store.appendAudit({
    document_id: document.id, step: 1, actor: "system", event: "received",
    payload: { filename: input.filename, sha256, size_bytes: input.bytes.byteLength, source: input.source },
  });
  return { document, created: true };
}

// The document as the pipeline may see it. corpus_meta names the GP, fund and period; letting extraction read it
// would make the evals measure leaked labels instead of the pipeline (see CorpusMeta).
export function forPipeline(doc: DocumentRecord): DocumentRecord {
  return { ...doc, corpus_meta: null };
}

// Corpus first (by doc id), then uploads newest first.
export async function listDocuments(store: DocumentStore): Promise<DocumentRecord[]> {
  const all = await store.list();
  const corpus = all.filter((d) => d.corpus_meta).sort((a, b) => (a.corpus_meta?.doc_id ?? "").localeCompare(b.corpus_meta?.doc_id ?? ""));
  const uploads = all.filter((d) => !d.corpus_meta).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return [...corpus, ...uploads];
}

// What /api/documents returns: the hash and storage path stay server-side.
export const DocumentSummary = DocumentRecord.pick({
  id: true, filename: true, mime: true, size_bytes: true, source: true, corpus_meta: true, created_at: true,
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

export function toDocumentSummary(doc: DocumentRecord): DocumentSummary {
  const { id, filename, mime, size_bytes, source, corpus_meta, created_at } = doc;
  return { id, filename, mime, size_bytes, source, corpus_meta, created_at };
}
