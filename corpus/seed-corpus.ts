// Registers every labeled corpus document through the same step-1 path as uploads (core/documents.ts).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { registerDocument, SPREADSHEET_MIME, type DocumentRecord, type DocumentStore } from "../core/documents.ts";
import { CorpusLabel } from "../core/schema.ts";

export async function seedCorpus(root: string, store: DocumentStore): Promise<{ document: DocumentRecord; created: boolean }[]> {
  const labelsDir = path.join(root, "corpus/labels");
  const results = [];
  for (const name of (await readdir(labelsDir)).filter((n) => n.endsWith(".json")).sort()) {
    const label = CorpusLabel.parse(JSON.parse(await readFile(path.join(labelsDir, name), "utf8")));
    const { gp_name, fund_name, period_end } = label.expected.classification;
    results.push(await registerDocument(store, {
      filename: path.basename(label.file),
      mime: label.format === "xlsx" ? SPREADSHEET_MIME : "application/pdf",
      bytes: new Uint8Array(await readFile(path.join(root, label.file))),
      source: "corpus",
      // Descriptive only: never copy label.expected values here (see CorpusMeta in core/documents.ts).
      corpus_meta: { doc_id: label.doc_id, gp_name, fund_name, period_end, format: label.format, split: label.split },
    }));
  }
  return results;
}
