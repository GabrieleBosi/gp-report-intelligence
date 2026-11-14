// Step 3 (parse by format): text per page, so read A (step 4) is always text-based (SPEC-pipeline decision 3).
// PDF pages use their text layer; pages without one (scans) are OCR'd; each workbook sheet becomes one page.
import { SPREADSHEET_MIME } from "../documents.ts";
import type { Step } from "./run.ts";

export type ParsedPage = {
  page: number; text: string; source: "text_layer" | "ocr" | "sheet"; needsOcr: boolean;
  quality?: number; // OCR pages: tesseract's mean word confidence, 0-100
};
export type ParsedDocument = { kind: "pdf" | "xlsx"; pages: ParsedPage[] };

export interface TextExtractor {
  pdfTextPages(pdf: Uint8Array): Promise<string[]>;
  ocrPage?(pdf: Uint8Array, page: number): Promise<{ text: string; confidence: number }>;
  sheets?(xlsx: Uint8Array): Promise<{ name: string; text: string }[]>; // cell grid with A1 refs and displayed values
  ocrDone?(): Promise<void>; // releases the OCR engine; called when parsing ends, whatever the outcome
}

// The longest document the pipeline accepts (the same limit as uploads, T5). It also bounds OCR: about 6 s a page.
export const MAX_PAGES = 20;
// The most text a document may hand to the LLM steps (it is sent to classify, four extract calls and the critic).
// A real quarterly report is 5-40k characters; the XLSX reader caps its output at the same size.
export const MAX_DOCUMENT_CHARS = 300_000;
const checkSize = (pages: ParsedPage[]) => {
  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  if (chars > MAX_DOCUMENT_CHARS) throw new Error(`too much text: ${chars} characters, at most ${MAX_DOCUMENT_CHARS} are accepted`);
};

// Below this many non-space characters a page has no real text layer: a scan, or an image-only page.
export const MIN_TEXT_CHARS = 50;

export function parseStep(extractor: TextExtractor): Step {
  return {
    name: "parse",
    async run(ctx) {
      if (!ctx.loaded) throw new Error("no document loaded (the load step must run first)");
      const { bytes, document } = ctx.loaded;

      if (document.mime === SPREADSHEET_MIME) {
        if (!extractor.sheets) throw new Error("no spreadsheet reader configured");
        const sheets = await extractor.sheets(bytes);
        // The sheet number is the page: labels and read A cite sheets the way they cite PDF pages.
        const pages: ParsedPage[] = sheets.map((s, i) => ({
          page: i + 1, text: `Sheet ${i + 1} "${s.name}"\n${s.text}`, source: "sheet", needsOcr: false,
        }));
        checkSize(pages);
        return { ctx: { ...ctx, parsed: { kind: "xlsx", pages } }, summary: { kind: "xlsx", pages: pages.length, sheets: sheets.map((s) => s.name) } };
      }
      if (document.mime !== "application/pdf") throw new Error(`${document.mime} is not supported`);

      const texts = await extractor.pdfTextPages(bytes);
      if (texts.length > MAX_PAGES) throw new Error(`the document has ${texts.length} pages; at most ${MAX_PAGES} are accepted`);
      const pages: ParsedPage[] = [];
      try {
        for (const [i, text] of texts.entries()) {
          const needsOcr = text.replace(/\s/g, "").length < MIN_TEXT_CHARS;
          if (needsOcr && extractor.ocrPage) {
            const ocr = await extractor.ocrPage(bytes, i + 1); // one page at a time: one OCR worker, bounded memory
            pages.push({ page: i + 1, text: ocr.text, source: "ocr", needsOcr: false, quality: ocr.confidence });
          } else {
            pages.push({ page: i + 1, text, source: "text_layer", needsOcr });
          }
        }
      } finally {
        await extractor.ocrDone?.().catch(() => {}); // free the OCR engine before the LLM steps; never mask an error
      }
      checkSize(pages);
      const ocrPages = pages.filter((p) => p.source === "ocr");
      return {
        ctx: { ...ctx, parsed: { kind: "pdf", pages } },
        summary: {
          kind: "pdf", pages: pages.length, textLayerPages: pages.filter((p) => p.source === "text_layer" && !p.needsOcr).length,
          needsOcrPages: pages.filter((p) => p.needsOcr).map((p) => p.page),
          ...(ocrPages.length > 0 ? {
            ocrPages: ocrPages.map((p) => p.page),
            ocrQuality: Math.round(ocrPages.reduce((s, p) => s + (p.quality ?? 0), 0) / ocrPages.length),
          } : {}),
        },
      };
    },
  };
}
