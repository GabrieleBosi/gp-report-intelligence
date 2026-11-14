// Records real Claude responses for a pipeline step on the dev corpus, for zero-cost replay in CI. Spends money
// (budget-guarded, logged to usage_ledger). Usage: node scripts/record-fixtures.ts <step> [formats]
//   step: ocr (records the scans' OCR text, no LLM) | classify | extract | critic | confidence
//   formats: comma-separated corpus formats, default native_pdf (e.g. xlsx,scanned_pdf)
import path from "node:path";
import { dailyBudgetUsd, withBudget } from "../core/budget.ts";
import { classifyStep } from "../core/pipeline/classify.ts";
import { confidenceStep } from "../core/pipeline/confidence-step.ts";
import { criticStep } from "../core/pipeline/critic.ts";
import { extractStep } from "../core/pipeline/extract.ts";
import { normalizeStep } from "../core/pipeline/normalize-step.ts";
import { anthropicFromEnv } from "../netlify/lib/anthropic-llm.ts";
import { pdfRasterizer } from "../netlify/lib/pdf.ts";
import { createReplayOrRecordLlm } from "../netlify/lib/replay-llm.ts";
import { createAdminClient } from "../netlify/lib/supabase.ts";
import { createSupabaseUsageLedger } from "../netlify/lib/usage-ledger.ts";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { parseStep } from "../core/pipeline/parse.ts";
import { createPdfPageOcr } from "../netlify/lib/ocr.ts";
import { extractTextPages, renderPageToPng } from "../netlify/lib/pdf.ts";
import type { CorpusLabel } from "../core/schema.ts";
import { devDocuments, FIXTURES, PARSED_FIXTURES, ROOT } from "../tests/support/dev-corpus.ts";
import { KNOWN_FUNDS } from "../tests/support/known-funds.ts";

process.loadEnvFile(path.join(ROOT, ".env"));
const step = process.argv[2];
if (!["ocr", "classify", "extract", "critic", "confidence"].includes(step ?? "")) {
  throw new Error("usage: node scripts/record-fixtures.ts ocr|classify|extract|critic|confidence [formats]");
}
const formats = (process.argv[3] ?? "native_pdf").split(",") as CorpusLabel["format"][];

if (step === "ocr") {
  // Step 3 on the dev scans, for real: the recorded text is what replay tests feed to steps 2 and 4-7.
  const ocr = createPdfPageOcr(renderPageToPng);
  await mkdir(PARSED_FIXTURES, { recursive: true });
  try {
    for (const name of (await readdir(path.join(ROOT, "corpus/labels"))).sort()) {
      const label = JSON.parse(await readFile(path.join(ROOT, "corpus/labels", name), "utf8")) as CorpusLabel;
      if (label.split !== "dev" || label.format !== "scanned_pdf") continue;
      const bytes = new Uint8Array(await readFile(path.join(ROOT, label.file)));
      const { ctx, summary } = await parseStep({ pdfTextPages: extractTextPages, ocrPage: ocr.ocrPage }).run({
        runId: "ocr", documentId: label.doc_id,
        loaded: { bytes, document: { id: label.doc_id, sha256: "", filename: name, mime: "application/pdf", size_bytes: bytes.byteLength,
          storage_path: label.file, source: "corpus", corpus_meta: null, created_at: "" } },
      });
      await writeFile(path.join(PARSED_FIXTURES, `${label.doc_id}.json`), JSON.stringify(ctx.parsed, null, 2) + "\n");
      console.log(label.doc_id, JSON.stringify(summary));
    }
  } finally {
    await ocr.close();
  }
  process.exit(0);
}
const db = createAdminClient(process.env);
if (!db) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");

// Budget wraps only live calls: replayed fixtures are free and must not count against the daily cap.
const llm = createReplayOrRecordLlm(withBudget(anthropicFromEnv(process.env.ANTHROPIC_API_KEY), createSupabaseUsageLedger(db),
  { budgetUsd: dailyBudgetUsd(process.env.DAILY_LLM_BUDGET_USD), runId: `local-record-${step}` }), FIXTURES);

let total = 0;
for (const { label, ctx } of await devDocuments(formats)) {
  const classified = await classifyStep(llm, { list: async () => KNOWN_FUNDS }, pdfRasterizer).run(ctx);
  if (step === "classify") {
    if (classified.summary?.cached !== true) total += Number(classified.summary?.costUsd ?? 0);
    console.log(label.doc_id, JSON.stringify(classified.summary));
    continue;
  }
  const extracted = await extractStep(llm, pdfRasterizer).run(classified.ctx);
  const normalized = await normalizeStep({ append: async () => {} }).run(extracted.ctx);
  if (step === "extract") {
    if (extracted.summary?.cached !== true) total += Number(extracted.summary?.costUsd ?? 0);
    console.log(label.doc_id, JSON.stringify(extracted.summary), JSON.stringify(normalized.summary));
    continue;
  }
  const checked = await criticStep(llm, { append: async () => {} }).run(normalized.ctx);
  if (step === "critic") {
    if (checked.summary?.cached !== true) total += Number(checked.summary?.costUsd ?? 0);
    console.log(label.doc_id, JSON.stringify(checked.summary));
    continue;
  }
  const decided = await confidenceStep(llm, pdfRasterizer, { append: async () => {} }).run(checked.ctx);
  if (decided.summary?.cached !== true) total += Number(decided.summary?.costUsd ?? 0);
  console.log(label.doc_id, label.expected_route, JSON.stringify(decided.summary));
}
console.log(`recorded; new live spend $${total.toFixed(4)}`);
