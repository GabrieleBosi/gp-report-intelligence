// npm run corpus:scan - (re)makes the scanned corpus documents from their native originals. Run after changing a
// scanned entry's original; the result is committed (see corpus/generator/scan.ts).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildEntry, MANIFEST } from "./generator/index.ts";
import { scanPdf } from "./generator/scan.ts";

const root = path.resolve(import.meta.dirname, "..");
for (const [i, entry] of MANIFEST.entries()) {
  if (entry.format !== "scanned_pdf") continue;
  const { label, document } = await buildEntry(entry);
  await writeFile(path.join(root, label.file), await scanPdf(document, 9000 + i));
  console.log(`scanned ${label.file}`);
}
