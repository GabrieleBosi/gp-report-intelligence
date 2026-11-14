import { describe, expect, it } from "vitest";
import { listDocuments, registerDocument, sha256Hex, toDocumentSummary } from "../../core/documents.ts";
import { InMemoryStore } from "../support/in-memory-store.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const PDF = "application/pdf";

describe("sha256Hex", () => {
  it("matches the standard test vector", async () => {
    expect(await sha256Hex(bytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("registerDocument", () => {
  it("stores the file under a content-addressed path and records the document", async () => {
    const store = new InMemoryStore();
    const sha = await sha256Hex(bytes("%PDF-report"));

    const { document, created } = await registerDocument(store, {
      filename: "Q2 report.pdf", mime: PDF, bytes: bytes("%PDF-report"), source: "upload",
    });

    expect(created).toBe(true);
    expect(document).toMatchObject({
      sha256: sha, filename: "Q2 report.pdf", mime: PDF, size_bytes: 11, storage_path: `upload/${sha}.pdf`, source: "upload", corpus_meta: null,
    });
    expect(store.files.get(`upload/${sha}.pdf`)?.mime).toBe(PDF);
  });

  it("appends a step-1 'received' audit event for a new document", async () => {
    const store = new InMemoryStore();

    const { document } = await registerDocument(store, { filename: "a.pdf", mime: PDF, bytes: bytes("a"), source: "upload" });

    expect(store.audit).toEqual([{
      document_id: document.id, step: 1, actor: "system", event: "received",
      payload: { filename: "a.pdf", sha256: document.sha256, size_bytes: 1, source: "upload" },
    }]);
  });

  it("returns the existing document for identical bytes without storing or auditing again", async () => {
    const store = new InMemoryStore();
    const first = await registerDocument(store, { filename: "a.pdf", mime: PDF, bytes: bytes("same"), source: "upload" });

    const second = await registerDocument(store, { filename: "renamed.pdf", mime: PDF, bytes: bytes("same"), source: "upload" });

    expect(second).toEqual({ document: first.document, created: false });
    expect(store.documents).toHaveLength(1);
    expect(store.audit).toHaveLength(1);
  });

  it("keeps corpus metadata for corpus documents", async () => {
    const store = new InMemoryStore();
    const corpus_meta = { doc_id: "alpenrose-iv-2026q2", gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", format: "native_pdf", split: "heldout" } as const;

    const { document } = await registerDocument(store, { filename: "alpenrose-iv-2026q2.pdf", mime: PDF, bytes: bytes("x"), source: "corpus", corpus_meta });

    expect(document.corpus_meta).toEqual(corpus_meta);
    expect(document.storage_path).toMatch(/^corpus\/[0-9a-f]{64}\.pdf$/);
  });

  it("uses the .xlsx extension for spreadsheets", async () => {
    const store = new InMemoryStore();
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    const { document } = await registerDocument(store, { filename: "capital account.xlsx", mime: xlsx, bytes: bytes("x"), source: "upload" });

    expect(document.storage_path).toMatch(/\.xlsx$/);
  });
});

describe("listDocuments", () => {
  it("lists corpus documents by doc id, then uploads newest first", async () => {
    const store = new InMemoryStore();
    const meta = (doc_id: string) => ({ doc_id, gp_name: "G", fund_name: "F", period_end: "2026-06-30", format: "native_pdf", split: "dev" } as const);
    await registerDocument(store, { filename: "u1.pdf", mime: PDF, bytes: bytes("u1"), source: "upload" });
    await registerDocument(store, { filename: "b.pdf", mime: PDF, bytes: bytes("b"), source: "corpus", corpus_meta: meta("b-2026q2") });
    await registerDocument(store, { filename: "a.pdf", mime: PDF, bytes: bytes("a"), source: "corpus", corpus_meta: meta("a-2026q2") });
    await registerDocument(store, { filename: "u2.pdf", mime: PDF, bytes: bytes("u2"), source: "upload" });

    const names = (await listDocuments(store)).map((d) => d.filename);

    expect(names).toEqual(["a.pdf", "b.pdf", "u2.pdf", "u1.pdf"]);
  });
});

describe("toDocumentSummary", () => {
  it("exposes what the UI needs and keeps the hash and storage path internal", async () => {
    const store = new InMemoryStore();
    const { document } = await registerDocument(store, { filename: "a.pdf", mime: PDF, bytes: bytes("a"), source: "upload" });

    const summary = toDocumentSummary(document);

    expect(Object.keys(summary).sort()).toEqual(["corpus_meta", "created_at", "filename", "id", "mime", "size_bytes", "source"]);
  });
});
