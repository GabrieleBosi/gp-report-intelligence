import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_CHARS, MAX_PAGES, parseStep, type TextExtractor } from "../../../core/pipeline/parse.ts";
import type { RunContext } from "../../../core/pipeline/run.ts";
import { SPREADSHEET_MIME } from "../../../core/documents.ts";

const ctxWith = (mime: string): RunContext => ({
  runId: "run-1", documentId: "doc-1",
  loaded: {
    bytes: new Uint8Array([1]),
    document: { id: "doc-1", sha256: "a".repeat(64), filename: "r", mime, size_bytes: 1, storage_path: "x", source: "upload", corpus_meta: null, created_at: "t" },
  },
});
const extractor = (pages: string[]): TextExtractor => ({ pdfTextPages: async () => pages });
const LONG = "Net asset value 352.4 Paid-in capital 330.5 Distributions 60.0 TVPI 1.45x";

describe("parseStep", () => {
  it("records each PDF page's text with the text layer as its source", async () => {
    const { ctx } = await parseStep(extractor([LONG, LONG])).run(ctxWith("application/pdf"));

    expect(ctx.parsed).toEqual({
      kind: "pdf",
      pages: [
        { page: 1, text: LONG, source: "text_layer", needsOcr: false },
        { page: 2, text: LONG, source: "text_layer", needsOcr: false },
      ],
    });
  });

  it("marks a page with almost no text as needing OCR (a scan) and says so in the summary", async () => {
    const { ctx, summary } = await parseStep(extractor([LONG, "  12  \n"])).run(ctxWith("application/pdf"));

    expect(ctx.parsed?.pages[1]?.needsOcr).toBe(true);
    expect(summary).toEqual({ kind: "pdf", pages: 2, textLayerPages: 1, needsOcrPages: [2] });
  });

  it("OCRs only the pages without a text layer and records the OCR quality", async () => {
    const ocrCalls: number[] = [];
    const withOcr: TextExtractor = {
      pdfTextPages: async () => [LONG, " 3 "],
      ocrPage: async (_pdf, page) => { ocrCalls.push(page); return { text: `ocr text of page ${page}`, confidence: 88.4 }; },
    };

    const { ctx, summary } = await parseStep(withOcr).run(ctxWith("application/pdf"));

    expect(ocrCalls).toEqual([2]);
    expect(ctx.parsed?.pages[1]).toEqual({ page: 2, text: "ocr text of page 2", source: "ocr", needsOcr: false, quality: 88.4 });
    expect(summary).toMatchObject({ textLayerPages: 1, ocrPages: [2], ocrQuality: 88 });
  });

  it("turns each sheet of a workbook into one page (sheet n = page n)", async () => {
    const withSheets: TextExtractor = {
      pdfTextPages: async () => [],
      sheets: async () => [{ name: "Capital account", text: "A1: Meridian Growth" }, { name: "Portfolio", text: "A5: Company" }],
    };

    const { ctx, summary } = await parseStep(withSheets).run(ctxWith(SPREADSHEET_MIME));

    expect(ctx.parsed).toEqual({ kind: "xlsx", pages: [
      { page: 1, text: 'Sheet 1 "Capital account"\nA1: Meridian Growth', source: "sheet", needsOcr: false },
      { page: 2, text: 'Sheet 2 "Portfolio"\nA5: Company', source: "sheet", needsOcr: false },
    ] });
    expect(summary).toEqual({ kind: "xlsx", pages: 2, sheets: ["Capital account", "Portfolio"] });
  });

  it("fails clearly when no spreadsheet reader is configured, or for an unknown format", async () => {
    await expect(parseStep(extractor([])).run(ctxWith(SPREADSHEET_MIME))).rejects.toThrow(/no spreadsheet reader/);
    await expect(parseStep(extractor([])).run(ctxWith("image/png"))).rejects.toThrow(/image\/png is not supported/);
  });

  it("rejects a PDF longer than the page cap before any OCR", async () => {
    let ocrCalls = 0;
    const long: TextExtractor = { pdfTextPages: async () => Array.from({ length: MAX_PAGES + 1 }, () => " "), ocrPage: async () => { ocrCalls++; return { text: "", confidence: 0 }; } };

    await expect(parseStep(long).run(ctxWith("application/pdf"))).rejects.toThrow(new RegExp(`${MAX_PAGES + 1} pages.*at most ${MAX_PAGES}`));
    expect(ocrCalls).toBe(0);
  });

  it("rejects a document with more text than any GP report has (bounds the LLM input of a run)", async () => {
    const wordy: TextExtractor = { pdfTextPages: async () => ["x".repeat(MAX_DOCUMENT_CHARS / 2), "y".repeat(MAX_DOCUMENT_CHARS / 2 + 1)] };

    await expect(parseStep(wordy).run(ctxWith("application/pdf"))).rejects.toThrow(/too much text/);
  });

  it("releases the OCR engine when parsing ends, also when OCR fails", async () => {
    let released = 0;
    const failing: TextExtractor = {
      pdfTextPages: async () => [" "], ocrPage: async () => { throw new Error("ocr crashed"); }, ocrDone: async () => { released++; },
    };
    const fine: TextExtractor = { pdfTextPages: async () => [" "], ocrPage: async () => ({ text: "t", confidence: 90 }), ocrDone: async () => { released++; } };

    await expect(parseStep(failing).run(ctxWith("application/pdf"))).rejects.toThrow(/ocr crashed/);
    await parseStep(fine).run(ctxWith("application/pdf"));
    expect(released).toBe(2);
  });

  it("fails if the load step did not run", async () => {
    await expect(parseStep(extractor([])).run({ runId: "r", documentId: "d" })).rejects.toThrow(/no document loaded/);
  });
});
