// POST /api/upload, as pure orchestration over ports (ADR-0001): guardrails first (size and type before anything is
// parsed), then the PDF page count, rate and duplicate checks, then step 1 (registerDocument) with source "upload".
// The function in netlify/functions/upload.ts only adapts HTTP to this.
import { registerDocument, sha256Hex, toDocumentSummary, type DocumentStore, type DocumentSummary } from "./documents.ts";
import { checkUpload, type GuardrailCode, type UploadCandidate } from "./guardrails.ts";

export type UploadDeps = {
  store: DocumentStore;
  countPdfPages(bytes: Uint8Array): Promise<number>;
  uploadsLastHour(): Promise<number>;
};
export type UploadResult =
  | { status: 200 | 201; body: { document: DocumentSummary; duplicate: boolean } }
  | { status: 413 | 415 | 422 | 429; body: { error: string; code: GuardrailCode | "unreadable" } };

const STATUS: Record<GuardrailCode, 413 | 415 | 422 | 429> = {
  too_large: 413, unsupported_type: 415, too_many_pages: 422, rate_limited: 429, budget_exceeded: 429,
};

// The name is shown in the UI and stored; it never becomes a path (storage paths are content-addressed).
// Control characters and bidirectional overrides (which can disguise "fdp.exe" as "exe.pdf") are removed.
const invisible = (cp: number) => cp < 0x20 || cp === 0x7f || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e)
  || (cp >= 0x2066 && cp <= 0x2069);

// The name is shown in the UI and stored; it never becomes a path (storage paths are content-addressed).
export function safeFilename(name: string): string {
  const base = [...(name.split(/[\\/]/).pop() ?? "")].filter((ch) => !invisible(ch.codePointAt(0) ?? 0)).join("").trim();
  if (!base) return "upload";
  if (base.length <= 200) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : "";
  return base.slice(0, 200 - ext.length) + ext;
}

export async function handleUpload(deps: UploadDeps, file: { filename: string; bytes: Uint8Array }): Promise<UploadResult> {
  const filename = safeFilename(file.filename);
  const reject = (code: GuardrailCode | "unreadable", error: string, status: 413 | 415 | 422 | 429): UploadResult =>
    ({ status, body: { error, code } });
  const base: UploadCandidate = { filename, bytes: file.bytes, pageCount: null, uploadsLastHour: 0, duplicateOf: null };

  // Size and type first: an oversized or foreign file is never opened.
  const first = checkUpload(base);
  if (!first.ok) return reject(first.code, first.message, STATUS[first.code]);

  let pageCount: number | null = null;
  if (first.mime === "application/pdf") {
    try {
      pageCount = await deps.countPdfPages(file.bytes);
    } catch {
      return reject("unreadable", `${filename} could not be opened as a PDF. It may be damaged or password-protected.`, 422);
    }
  }
  const existing = await deps.store.findBySha256(await sha256Hex(file.bytes));
  const decision = checkUpload({ ...base, pageCount, uploadsLastHour: await deps.uploadsLastHour(), duplicateOf: existing?.id ?? null });
  if (!decision.ok) return reject(decision.code, decision.message, STATUS[decision.code]);
  if (existing) return { status: 200, body: { document: toDocumentSummary(existing), duplicate: true } };

  const { document } = await registerDocument(deps.store, { filename, mime: decision.mime, bytes: file.bytes, source: "upload" });
  return { status: 201, body: { document: toDocumentSummary(document), duplicate: false } };
}
