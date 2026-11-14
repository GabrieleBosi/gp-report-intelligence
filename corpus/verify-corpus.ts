// Checks the committed corpus: every label is schema-valid, identities fail exactly as declared, and every
// committed file is what the generator produces today (so labels and documents can never drift apart).
import { createHash } from "node:crypto";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runIdentityChecks } from "../core/checks/identities.ts";
import { CorpusLabel } from "../core/schema.ts";
import { extractTextPages } from "../netlify/lib/pdf.ts";
import { generateCorpus } from "./generator/index.ts";

export type CorpusRow = {
  doc_id: string; gp: string; split: string; format: string; scenario: string; targets: string; route: string; flags: string;
};

// What each document is designed to provoke in step 7. Labels can only state the design: whether the two reads agree is
// decided at run time (an OCR document *may* produce a misread). The guaranteed proof of the "reads disagree" cells is
// the injected-misread safety test (tests/core/pipeline/confidence-replay.test.ts).
export function scenarioOf(label: CorpusLabel): { scenario: string; targets: string } {
  const ocr = label.format === "scanned_pdf";
  if (label.expected_route === "triage") return { scenario: "unknown GP", targets: "triage" };
  if (label.trap === "chart_nav") return { scenario: "figure only in an image", targets: "correlated reads (image only)" };
  if (label.expected_flags.length > 0) {
    return ocr ? { scenario: "OCR + source inconsistency", targets: "checks fail · reads may disagree (OCR)" }
      : { scenario: "source inconsistency", targets: "checks fail · reads agree" };
  }
  return ocr ? { scenario: "OCR (misread risk)", targets: "checks pass · reads may disagree (OCR)" }
    : { scenario: "clean", targets: "checks pass · reads agree" };
}
export type VerifyResult = { issues: string[]; rows: CorpusRow[] };

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const exists = (file: string) => access(file).then(() => true, () => false);

export async function verifyCorpus(root: string): Promise<VerifyResult> {
  const issues: string[] = [];
  const labelsDir = path.join(root, "corpus/labels");
  const labels: CorpusLabel[] = [];

  for (const name of (await readdir(labelsDir)).filter((n) => n.endsWith(".json")).sort()) {
    const parsed = CorpusLabel.safeParse(JSON.parse(await readFile(path.join(labelsDir, name), "utf8")));
    if (!parsed.success) {
      issues.push(`${name}: invalid label: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      continue;
    }
    if (`${parsed.data.doc_id}.json` !== name) issues.push(`${name}: doc_id ${parsed.data.doc_id} does not match file name`);
    if (!(await exists(path.join(root, parsed.data.file)))) issues.push(`${name}: document ${parsed.data.file} is missing`);
    labels.push(parsed.data);
  }

  // Identities run per fund in period order, so quarter-on-quarter checks see the previous regular (non-trap) label.
  const byFund = Map.groupBy(labels, (l) => l.expected.classification.fund_name);
  for (const fundLabels of byFund.values()) {
    fundLabels.sort((a, b) => a.expected.classification.period_end.localeCompare(b.expected.classification.period_end));
    fundLabels.forEach((label, i) => {
      // A scan shares its original's quarter, so only strictly earlier quarters count as "previous".
      const previous = fundLabels.slice(0, i)
        .filter((l) => !l.trap && l.expected.classification.period_end < label.expected.classification.period_end).at(-1);
      const failed = runIdentityChecks(label.expected, label.trap ? null : previous?.expected ?? null)
        .filter((c) => c.status === "fail").map((c) => c.id).sort();
      const declared = [...label.expected_flags].sort();
      if (failed.join() !== declared.join()) {
        issues.push(`${label.doc_id}: checks failed [${failed.join(", ")}] but label declares [${declared.join(", ")}]`);
      }
    });
  }

  issues.push(...(await compareWithGenerator(root, labels)));
  const rows = labels.map((l) => ({
    doc_id: l.doc_id, gp: l.expected.classification.gp_name, split: l.split, format: l.format, ...scenarioOf(l),
    route: l.expected_route, flags: l.expected_flags.join(", ") || "-",
  }));
  return { issues, rows };
}

async function compareWithGenerator(root: string, labels: CorpusLabel[]): Promise<string[]> {
  const issues: string[] = [];
  const fresh = await mkdtemp(path.join(tmpdir(), "corpus-verify-"));
  try {
    const generated = new Set(await generateCorpus(fresh));
    // Scans depend on the local ImageMagick version: generated once, committed, excluded from the regeneration check.
    const scans = new Set(labels.filter((l) => l.format === "scanned_pdf").map((l) => l.file));
    // Raster content (the chart trap) is not byte-identical across machines (CI vs local), so those documents are
    // compared by their text layer instead; their labels are still fully checked above.
    const rasterized = new Set(labels.filter((l) => l.trap === "chart_nav").map((l) => l.file));

    for (const file of generated) {
      if (scans.has(file)) continue;
      const committed = path.join(root, file);
      if (!(await exists(committed))) { issues.push(`${file}: generated but not committed (run npm run corpus:generate)`); continue; }
      const [mine, theirs] = [await readFile(committed), await readFile(path.join(fresh, file))];
      const same = rasterized.has(file)
        ? JSON.stringify(await extractTextPages(new Uint8Array(mine))) === JSON.stringify(await extractTextPages(new Uint8Array(theirs)))
        : sha256(mine) === sha256(theirs);
      if (!same) issues.push(`${file}: committed file differs from generator output (run npm run corpus:generate)`);
    }
    for (const dir of ["corpus/docs", "corpus/labels"]) {
      for (const name of await readdir(path.join(root, dir))) {
        const file = `${dir}/${name}`;
        if (!generated.has(file) && !scans.has(file)) issues.push(`${file}: committed but not produced by the generator`);
      }
    }
  } finally {
    await rm(fresh, { recursive: true, force: true });
  }
  return issues;
}
