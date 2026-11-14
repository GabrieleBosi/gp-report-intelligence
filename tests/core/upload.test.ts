import { describe, expect, it } from "vitest";
import { SPREADSHEET_MIME } from "../../core/documents.ts";
import { handleUpload, safeFilename, type UploadDeps } from "../../core/upload.ts";
import { InMemoryStore } from "../support/in-memory-store.ts";

const pdf = (marker = "a", size = 2_000) => { const b = new Uint8Array(size); b.set(new TextEncoder().encode(`%PDF-1.7 ${marker}`)); return b; };

function deps(over: Partial<UploadDeps> = {}): UploadDeps & { store: InMemoryStore; counted: number } {
  const store = new InMemoryStore();
  const d = {
    store, counted: 0,
    async countPdfPages() { d.counted++; return 3; },
    async uploadsLastHour() { return 0; },
    ...over,
  };
  return d as UploadDeps & { store: InMemoryStore; counted: number };
}

describe("handleUpload (POST /api/upload)", () => {
  it("stores an accepted PDF as an upload with its step-1 audit event", async () => {
    const d = deps();

    const result = await handleUpload(d, { filename: "Q2 report.pdf", bytes: pdf() });

    expect(result).toMatchObject({ status: 201, body: { duplicate: false, document: { filename: "Q2 report.pdf", source: "upload", mime: "application/pdf" } } });
    expect(d.store.documents).toHaveLength(1);
    expect(d.store.audit).toEqual([expect.objectContaining({ step: 1, event: "received", actor: "system" })]);
    expect([...d.store.files.keys()][0]).toMatch(/^upload\/[0-9a-f]{64}\.pdf$/);
  });

  it("answers a duplicate with the existing document, storing nothing new", async () => {
    const d = deps();
    const first = await handleUpload(d, { filename: "a.pdf", bytes: pdf() });

    const again = await handleUpload(d, { filename: "renamed.pdf", bytes: pdf() });

    expect(again).toMatchObject({ status: 200, body: { duplicate: true, document: { id: (first.body as { document: { id: string } }).document.id } } });
    expect(d.store.documents).toHaveLength(1);
  });

  it.each([
    ["too large", { bytes: pdf("x", 11 * 1024 * 1024) }, 413, "too_large"],
    ["not a PDF or workbook", { bytes: new Uint8Array([0x4d, 0x5a, 1, 2]) }, 415, "unsupported_type"],
  ])("rejects a file that is %s before counting pages or storing anything", async (_, file, status, code) => {
    const d = deps();

    const result = await handleUpload(d, { filename: "x.pdf", ...file });

    expect(result).toMatchObject({ status, body: { code, error: expect.any(String) } });
    expect(d.counted).toBe(0);
    expect(d.store.files.size).toBe(0);
  });

  it("rejects a PDF over the page limit, and the 31st upload of the hour", async () => {
    expect(await handleUpload(deps({ countPdfPages: async () => 21 }), { filename: "long.pdf", bytes: pdf() }))
      .toMatchObject({ status: 422, body: { code: "too_many_pages" } });
    expect(await handleUpload(deps({ uploadsLastHour: async () => 30 }), { filename: "a.pdf", bytes: pdf() }))
      .toMatchObject({ status: 429, body: { code: "rate_limited" } });
  });

  it("rejects a PDF that cannot be opened, with a clear message", async () => {
    const result = await handleUpload(deps({ countPdfPages: async () => { throw new Error("Invalid PDF structure"); } }), { filename: "broken.pdf", bytes: pdf() });

    expect(result).toMatchObject({ status: 422, body: { code: "unreadable", error: expect.stringMatching(/broken\.pdf could not be opened/) } });
  });

  it("accepts a workbook without counting pages", async () => {
    const d = deps();
    const workbook = new TextEncoder().encode(`PK\x03\x04${"\0".repeat(26)}PK\x01\x02${"\0".repeat(42)}xl/workbook.xml`);

    const result = await handleUpload(d, { filename: "capital account.xlsx", bytes: workbook });

    expect(result).toMatchObject({ status: 201, body: { document: { mime: SPREADSHEET_MIME } } });
    expect(d.counted).toBe(0);
  });
});

describe("safeFilename", () => {
  it.each([
    ["C:\\\\Users\\\\gp\\\\Q2.pdf", "Q2.pdf"],
    ["../../etc/passwd.pdf", "passwd.pdf"],
    ["bad\u0000name\u202e.pdf", "badname.pdf"],
    ["   ", "upload"],
    [`${"a".repeat(300)}.pdf`, `${"a".repeat(196)}.pdf`],
  ])("%j -> %j", (input, expected) => expect(safeFilename(input)).toBe(expected));
});
