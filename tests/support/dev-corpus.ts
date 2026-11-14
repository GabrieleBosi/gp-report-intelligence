import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "../../core/hash.ts";
import { CorpusLabel } from "../../core/schema.ts";
import type { RunContext } from "../../core/pipeline/run.ts";
import { extractTextPages } from "../../netlify/lib/pdf.ts";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const FIXTURES = path.join(ROOT, "tests/fixtures/llm");

// Dev split only: replay tests assert correctness, and asserting on held-out documents would turn the held-out set
// into something prompts get tuned against (SPEC-corpus: never evaluate on held-out while tuning).
export async function devPdfDocuments(): Promise<{ label: CorpusLabel; ctx: RunContext }[]> {
  const dir = path.join(ROOT, "corpus/labels");
  const labels = (await Promise.all((await readdir(dir)).sort().map(async (n) =>
    CorpusLabel.parse(JSON.parse(await readFile(path.join(dir, n), "utf8"))))))
    .filter((l) => l.split === "dev" && l.format === "native_pdf");
  return Promise.all(labels.map(async (label) => {
    const bytes = new Uint8Array(await readFile(path.join(ROOT, label.file)));
    const texts = await extractTextPages(bytes);
    const ctx: RunContext = {
      runId: `fixture-${label.doc_id}`, documentId: label.doc_id,
      loaded: { bytes, document: { id: label.doc_id, sha256: await sha256Hex(bytes), filename: path.basename(label.file),
        mime: "application/pdf", size_bytes: bytes.byteLength, storage_path: label.file, source: "corpus", corpus_meta: null, created_at: "" } },
      parsed: { kind: "pdf", pages: texts.map((text, i) => ({ page: i + 1, text, source: "text_layer", needsOcr: false })) },
    };
    return { label, ctx };
  }));
}

export const PARSED_FIXTURES = path.join(ROOT, "tests/fixtures/parsed");

// Every dev document, parsed by the real step 3. Workbooks parse deterministically. OCR output may differ slightly
// between machines (CI vs local), which would change the LLM cache keys, so a scan's OCR text is recorded once
// (scripts/record-fixtures.ts) and replayed from tests/fixtures/parsed/<doc_id>.json.
// split "heldout" is for measurement only (SPEC-evals: never tuned on, never recorded as fixtures).
export async function devDocuments(formats: CorpusLabel["format"][], split: CorpusLabel["split"] = "dev"): Promise<{ label: CorpusLabel; ctx: RunContext }[]> {
  const dir = path.join(ROOT, "corpus/labels");
  const labels = (await Promise.all((await readdir(dir)).sort().map(async (n) =>
    CorpusLabel.parse(JSON.parse(await readFile(path.join(dir, n), "utf8"))))))
    .filter((l) => l.split === split && formats.includes(l.format));
  const { parseStep } = await import("../../core/pipeline/parse.ts");
  const { readSheets } = await import("../../netlify/lib/xlsx.ts");
  const { SPREADSHEET_MIME } = await import("../../core/documents.ts");
  return Promise.all(labels.map(async (label) => {
    const bytes = new Uint8Array(await readFile(path.join(ROOT, label.file)));
    const ctx: RunContext = {
      runId: `fixture-${label.doc_id}`, documentId: label.doc_id,
      loaded: { bytes, document: { id: label.doc_id, sha256: await sha256Hex(bytes), filename: path.basename(label.file),
        mime: label.format === "xlsx" ? SPREADSHEET_MIME : "application/pdf", size_bytes: bytes.byteLength,
        storage_path: label.file, source: "corpus", corpus_meta: null, created_at: "" } },
    };
    if (label.format === "scanned_pdf") {
      const file = path.join(PARSED_FIXTURES, `${label.doc_id}.json`);
      const parsed = await readFile(file, "utf8").catch(() => {
        throw new Error(`no recorded OCR for ${label.doc_id}: run node scripts/record-fixtures.ts ocr`);
      });
      return { label, ctx: { ...ctx, parsed: JSON.parse(parsed) } };
    }
    const { ctx: parsedCtx } = await parseStep({ pdfTextPages: extractTextPages, sheets: readSheets }).run(ctx);
    return { label, ctx: parsedCtx };
  }));
}
