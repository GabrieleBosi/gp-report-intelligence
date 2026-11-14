// npm run eval:harvest - builds evals/golden.json from the corpus labels and the analyst corrections in the review log
// (SPEC-evals decision 4: harvested on demand and committed; CI never touches the database).
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildGolden, type HarvestedCorrection } from "../core/evals/golden.ts";
import { CorpusLabel } from "../core/schema.ts";
import { createAdminClient } from "../netlify/lib/supabase.ts";

const root = path.resolve(import.meta.dirname, "..");
process.loadEnvFile(path.join(root, ".env"));
const db = createAdminClient(process.env);
if (!db) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");

const labels = await Promise.all((await readdir(path.join(root, "corpus/labels"))).filter((n) => n.endsWith(".json")).sort()
  .map(async (n) => CorpusLabel.parse(JSON.parse(await readFile(path.join(root, "corpus/labels", n), "utf8")))));

const { data, error } = await db.from("review_decisions")
  .select("field, after, analyst, created_at, pipeline_runs(documents(sha256, filename, corpus_meta))")
  .eq("kind", "field_corrected").order("id");
if (error) throw new Error(`read corrections: ${error.message}`);
const corrections: HarvestedCorrection[] = data.map((d) => {
  const doc = (d.pipeline_runs as unknown as { documents: { sha256: string; filename: string; corpus_meta: { doc_id?: string } | null } }).documents;
  const after = d.after as { raw: string; page: number; value?: number | null };
  return { document_sha256: doc.sha256, filename: doc.filename, corpus_doc_id: doc.corpus_meta?.doc_id ?? null, field: d.field ?? "",
    raw: after.raw, page: after.page, value: after.value ?? null, analyst: d.analyst, decided_at: d.created_at };
});

const golden = buildGolden(labels, corrections);
await writeFile(path.join(root, "evals/golden.json"), JSON.stringify(golden, null, 2) + "\n");
console.log(`golden set: ${golden.documents.length} documents (${golden.documents.filter((d) => d.split === "dev").length} dev), ` +
  `${golden.corrections.length} corrections from ${corrections.length} decisions, ${golden.disagreements.length} disagreeing with a label`);
for (const c of golden.corrections) console.log(`  ${c.filename} ${c.field}: ${c.expected_raw} (page ${c.page}) ×${c.times} · label agrees: ${c.agrees_with_label}`);
for (const d of golden.disagreements) console.log(`  DISAGREES ${d.doc_id} ${d.field}: label ${d.label_value} vs corrected ${d.corrected_value} (${d.analyst})`);
