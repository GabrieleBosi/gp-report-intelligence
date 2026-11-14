import { describe, expect, it } from "vitest";
import { checkRunBudget, checkUpload, UPLOAD_LIMITS, type UploadCandidate } from "../../core/guardrails.ts";
import { SPREADSHEET_MIME } from "../../core/documents.ts";

const pdf = (size = 1_000) => { const b = new Uint8Array(size); b.set(new TextEncoder().encode("%PDF-1.7\n")); return b; };
// A minimal zip whose central directory lists the given entry names (that is all the format check reads).
function zipNamed(...names: string[]): Uint8Array {
  const parts = names.map((n) => `PK\x01\x02${"\0".repeat(42)}${n}`).join("");
  return new TextEncoder().encode(`PK\x03\x04${"\0".repeat(26)}${parts}PK\x05\x06${"\0".repeat(18)}`);
}
const candidate = (over: Partial<UploadCandidate> = {}): UploadCandidate => ({
  filename: "report.pdf", bytes: pdf(), pageCount: 3, uploadsLastHour: 0, duplicateOf: null, ...over,
});

describe("checkUpload (SPEC-platform guardrails)", () => {
  it("accepts a PDF within every limit, and an XLSX workbook", () => {
    expect(checkUpload(candidate())).toEqual({ ok: true, mime: "application/pdf", duplicateOf: null });
    expect(checkUpload(candidate({ filename: "s.xlsx", bytes: zipNamed("[Content_Types].xml", "xl/workbook.xml"), pageCount: null })))
      .toEqual({ ok: true, mime: SPREADSHEET_MIME, duplicateOf: null });
  });

  it("rejects a file over 4 MB (the platform's body limit, measured)", () => {
    expect(checkUpload(candidate({ bytes: pdf(4 * 1024 * 1024) })).ok).toBe(true);
    expect(checkUpload(candidate({ bytes: pdf(12 * 1024 * 1024) }))).toMatchObject({ ok: false, code: "too_large", message: expect.stringMatching(/12\.0 MB.*4 MB/) });
  });

  it("checks the content, not the name: an .exe renamed to .pdf, a Word file renamed to .xlsx", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]);
    expect(checkUpload(candidate({ filename: "report.pdf", bytes: exe }))).toMatchObject({ ok: false, code: "unsupported_type" });
    expect(checkUpload(candidate({ filename: "fund.xlsx", bytes: zipNamed("[Content_Types].xml", "word/document.xml"), pageCount: null })))
      .toMatchObject({ ok: false, code: "unsupported_type", message: expect.stringMatching(/PDF or Excel/) });
  });

  it("rejects a PDF with more than 20 pages", () => {
    expect(checkUpload(candidate({ pageCount: UPLOAD_LIMITS.maxPages + 1 }))).toMatchObject({ ok: false, code: "too_many_pages", message: expect.stringMatching(/21 pages.*20/) });
  });

  it("rejects the 31st upload within an hour, site-wide", () => {
    expect(checkUpload(candidate({ uploadsLastHour: 29 })).ok).toBe(true);
    expect(checkUpload(candidate({ uploadsLastHour: 30 }))).toMatchObject({ ok: false, code: "rate_limited", message: expect.stringMatching(/30 uploads per hour/) });
  });

  it("accepts a file that was already uploaded and points to the existing document instead of storing it twice", () => {
    expect(checkUpload(candidate({ duplicateOf: "doc-7" }))).toEqual({ ok: true, mime: "application/pdf", duplicateOf: "doc-7" });
  });

  it("checks size first, so an oversized file is never parsed", () => {
    expect(checkUpload(candidate({ bytes: new Uint8Array(11 * 1024 * 1024), pageCount: 99 }))).toMatchObject({ code: "too_large" });
  });
});

describe("checkRunBudget", () => {
  it("refuses a run once today's spend reaches the daily budget, with a message for the UI", () => {
    expect(checkRunBudget(14.99, 15)).toEqual({ ok: true });
    expect(checkRunBudget(15, 15)).toMatchObject({ ok: false, code: "budget_exceeded", message: expect.stringMatching(/\$15\.00.*tomorrow/) });
  });
});
