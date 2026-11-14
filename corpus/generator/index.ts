// The corpus manifest: which document is generated from which fund, seed and quarter, and how it is labeled.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CorpusLabel, Extraction } from "../../core/schema.ts";
import { generateFund } from "./model.ts";
import { profileById } from "./profiles.ts";
import { renderStandardReport } from "./render-pdf.ts";
import { renderCapitalAccountWorkbook } from "./render-xlsx.ts";
import { applyTrap, type Trap } from "./traps.ts";

export type CorpusEntry = {
  profileId: string;
  seed: number;
  quarter: number; // index into profile.periods
  split: CorpusLabel["split"];
  format: CorpusLabel["format"];
  periods?: string[]; // overrides profile.periods (traps use Q3 2025, a quarter no other document covers)
  trap?: Trap;
};

// Traps sit in Q3 2025 so they never duplicate a quarter already in the corpus: a trap copied from a held-out
// quarter would leak that quarter's numbers into the dev split.
const TRAP_QUARTER = ["2025-09-30"];
const TRAP_SUFFIX: Record<Trap, string> = { tvpi_misprint: "tvpi-misprint", chart_nav: "chart-nav", restatement: "restatement" };

// The latest quarter of each known GP is held out, so prompts are never tuned on it (SPEC-corpus "Documents").
export const MANIFEST: CorpusEntry[] = [
  { profileId: "alpenrose-iv", seed: 4101, quarter: 0, split: "dev", format: "native_pdf" },
  { profileId: "alpenrose-iv", seed: 4101, quarter: 1, split: "dev", format: "native_pdf" },
  { profileId: "alpenrose-iv", seed: 4101, quarter: 2, split: "heldout", format: "native_pdf" },
  { profileId: "harbourline-ii", seed: 4201, quarter: 0, split: "dev", format: "native_pdf" },
  { profileId: "harbourline-ii", seed: 4201, quarter: 1, split: "dev", format: "native_pdf" },
  { profileId: "harbourline-ii", seed: 4201, quarter: 2, split: "heldout", format: "native_pdf" },
  { profileId: "nordkap-iii", seed: 4301, quarter: 0, split: "dev", format: "native_pdf" },
  { profileId: "nordkap-iii", seed: 4301, quarter: 1, split: "dev", format: "native_pdf" },
  { profileId: "nordkap-iii", seed: 4301, quarter: 2, split: "heldout", format: "native_pdf" },
  { profileId: "meridian-i", seed: 4401, quarter: 0, split: "dev", format: "xlsx" },
  { profileId: "meridian-i", seed: 4401, quarter: 1, split: "dev", format: "xlsx" },
  { profileId: "meridian-i", seed: 4401, quarter: 2, split: "heldout", format: "xlsx" },
  // Traps: two in dev, because the critic (P10) and the vision fallback (P11) are proven on them by replay tests,
  // which only ever use dev documents.
  { profileId: "harbourline-ii", seed: 4201, quarter: 0, split: "dev", format: "native_pdf", periods: TRAP_QUARTER, trap: "tvpi_misprint" },
  { profileId: "alpenrose-iv", seed: 4101, quarter: 0, split: "dev", format: "native_pdf", periods: TRAP_QUARTER, trap: "chart_nav" },
  { profileId: "nordkap-iii", seed: 4301, quarter: 0, split: "heldout", format: "native_pdf", periods: TRAP_QUARTER, trap: "restatement" },
  // Unknown GP: not in known_funds, own layout; routed to triage.
  { profileId: "tessera-seed-i", seed: 4501, quarter: 0, split: "heldout", format: "native_pdf" },
  // Scans of dev documents (no text layer: OCR path). Both in dev, so no held-out numbers appear in a dev document.
  // Trap 1 scanned combines OCR noise with a source inconsistency.
  { profileId: "harbourline-ii", seed: 4201, quarter: 0, split: "dev", format: "scanned_pdf", periods: TRAP_QUARTER, trap: "tvpi_misprint" },
  { profileId: "nordkap-iii", seed: 4301, quarter: 1, split: "dev", format: "scanned_pdf" },
];

// Labels record what the document PRINTS. The standard layout has no investment-date column, so a correct
// extraction returns null there; the label must say null too, or evals would blame the pipeline for a labeling error.
export function asPrintedByStandardLayout(report: Extraction): Extraction {
  return { ...report, portfolio_companies: report.portfolio_companies.map((c) => ({ ...c, investment_date: null })) };
}

export function docIdFor(profileId: string, periodEnd: string): string {
  const [year, month] = periodEnd.split("-").map(Number);
  return `${profileId}-${year}q${Math.ceil((month ?? 1) / 3)}`;
}

export type BuiltEntry = { label: CorpusLabel; document: Buffer };

// One manifest entry -> its label and its document. For a scan, `document` is the native PDF the scan is made from
// (corpus/scan.ts rasterizes it); the label is the same, since a scan prints exactly what the original prints.
export async function buildEntry(entry: CorpusEntry): Promise<BuiltEntry> {
  const base = profileById(entry.profileId);
  const profile = entry.periods ? { ...base, periods: entry.periods } : base;
  const report = generateFund(profile, entry.seed)[entry.quarter];
  if (!report) throw new Error(`${entry.profileId} has no quarter ${entry.quarter}`);
  const trap = entry.trap ? applyTrap(entry.trap, report, profile) : null;

  const xlsx = entry.format === "xlsx";
  const docId = docIdFor(profile.id, report.classification.period_end) + (entry.trap ? `-${TRAP_SUFFIX[entry.trap]}` : "")
    + (entry.format === "scanned_pdf" ? "-scan" : "");
  const label: CorpusLabel = {
    doc_id: docId, file: `corpus/docs/${docId}.${xlsx ? "xlsx" : "pdf"}`, split: entry.split, format: entry.format,
    // The workbook prints investment dates; the standard PDF layout does not.
    expected: xlsx ? (trap?.label ?? report) : asPrintedByStandardLayout(trap?.label ?? report),
    expected_flags: trap?.flags ?? [],
    expected_route: trap ? "review" : profile.knownGp ? "auto_post" : "triage",
    ...(entry.trap ? { trap: entry.trap } : {}),
  };
  const document = xlsx ? await renderCapitalAccountWorkbook(trap?.render ?? report)
    : await renderStandardReport(trap?.render ?? report, profile, trap?.options);
  return { label, document };
}

// Writes corpus/docs/* and corpus/labels/* under outRoot and returns the relative paths written. Scanned documents
// get only their label here: the scan itself depends on ImageMagick, so `npm run corpus:scan` makes it once.
export async function generateCorpus(outRoot: string): Promise<string[]> {
  await mkdir(path.join(outRoot, "corpus/docs"), { recursive: true });
  await mkdir(path.join(outRoot, "corpus/labels"), { recursive: true });
  const written: string[] = [];
  for (const entry of MANIFEST) {
    const { label, document } = await buildEntry(entry);
    const labelPath = `corpus/labels/${label.doc_id}.json`;
    if (entry.format !== "scanned_pdf") {
      await writeFile(path.join(outRoot, label.file), document);
      written.push(label.file);
    }
    await writeFile(path.join(outRoot, labelPath), JSON.stringify(label, null, 2) + "\n");
    written.push(labelPath);
  }
  return written;
}
