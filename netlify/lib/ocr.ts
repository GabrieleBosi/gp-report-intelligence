// OCR for scanned pages (SPEC-pipeline decision 3: read A stays text-based for every format).
// Language data ships with the function (@tesseract.js-data/eng), so OCR never downloads anything at runtime.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker, OEM } from "tesseract.js";

// LSTM-only integer model: 2.9 MB instead of 10.9 MB for the legacy+LSTM data, and what OEM.LSTM_ONLY loads.
const LANG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("@tesseract.js-data/eng/package.json"))), "4.0.0_best_int",
);

export type OcrResult = { text: string; confidence: number }; // confidence: tesseract's mean word confidence, 0-100

export type Ocr = { recognize(png: Buffer): Promise<OcrResult>; close(): Promise<void> };

// One worker per run: creating it loads ~3 MB of model data, so reuse it across pages.
export async function createOcr(): Promise<Ocr> {
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    langPath: LANG_PATH,
    gzip: true,
    cacheMethod: "none", // the function filesystem is read-only and the data is already local
  });
  return {
    async recognize(png) {
      const { data } = await worker.recognize(png);
      return { text: data.text, confidence: data.confidence };
    },
    close: () => worker.terminate().then(() => undefined),
  };
}

// Rendered at 200 dpi: the resolution the spike measured (ADR-0004); scans in the corpus are 150 dpi images.
export const OCR_DPI = 200;

// The parse step's OCR port: renders a PDF page and OCRs it, starting the worker only if a page needs it. `close` is
// idempotent and never throws (it runs in finally blocks, where an error would mask the real one).
export function createPdfPageOcr(render: (pdf: Uint8Array, page: number, dpi: number) => Promise<Buffer>,
  start: () => Promise<Ocr> = createOcr) {
  let worker: Promise<Ocr> | null = null;
  return {
    async ocrPage(pdf: Uint8Array, page: number): Promise<OcrResult> {
      worker ??= start();
      return (await worker).recognize(await render(pdf, page, OCR_DPI));
    },
    async close() {
      const running = worker;
      worker = null;
      if (running) await running.then((w) => w.close()).catch(() => {});
    },
  };
}
