import { describe, expect, it } from "vitest";
import { parseUploadResponse } from "../../src/lib/api.ts";

const document = { id: "d1", filename: "q2.pdf", mime: "application/pdf", size_bytes: 1000, source: "upload", corpus_meta: null, created_at: "2026-10-11T10:00:00Z" };

describe("parseUploadResponse", () => {
  it("returns the stored document, and says when it was already there", () => {
    expect(parseUploadResponse(201, { document, duplicate: false })).toEqual({ ok: true, document, duplicate: false });
    expect(parseUploadResponse(200, { document, duplicate: true })).toMatchObject({ ok: true, duplicate: true });
  });

  it("shows the server's message for a rejection", () => {
    expect(parseUploadResponse(415, { error: "x.pdf is not a PDF or Excel (.xlsx) file.", code: "unsupported_type" }))
      .toEqual({ ok: false, message: "x.pdf is not a PDF or Excel (.xlsx) file." });
  });

  it("explains failures without a usable body (platform limit, network)", () => {
    expect(parseUploadResponse(413, null)).toEqual({ ok: false, message: "The file is too large to upload." });
    expect(parseUploadResponse(0, null)).toEqual({ ok: false, message: "The upload failed (HTTP network error)." });
    expect(parseUploadResponse(201, { unexpected: true })).toMatchObject({ ok: false });
  });
});
