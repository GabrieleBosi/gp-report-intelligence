// One eval report per document and per run: scores (metrics.ts), every wrong value with its first bad step
// (first-bad-step.ts), the route, and what producing it cost. The runner supplies the per-step evidence.
import type { Extraction } from "../schema.ts";
import { attribute, attributeRoute } from "./first-bad-step.ts";
import { compareDocument, type DocumentScore, type Summary } from "./metrics.ts";

export type DocumentEvidence = {
  doc_id: string; split: string; format: string;
  expected: Extraction; expected_route: string;
  round0: Extraction | null; // after steps 4-5 (before the critic)
  final: Extraction | null; // after the critic (what step 7 assessed)
  route: string | null;
  round0Raw(path: string): string | null; // what step 4 read for the label's field
  pageText(page: number): string; // the parsed text of a page (text layer, OCR or sheet)
  printedForms(path: string, value: number | null): string[]; // how this GP prints the value
  costUsd: number;
};
export type EvalError = { path: string; label: string; key: boolean; expected: number | null; actual: number | null; step: 2 | 3 | 4 | 5 | 6 | 7 };
export type DocumentReport = Omit<DocumentScore, "keyFigures" | "allFigures"> & {
  doc_id: string; split: string; format: string; route: string | null; expected_route: string; costUsd: number;
  keyFigures: { total: number; correct: number }; allFigures: { total: number; correct: number }; errors: EvalError[];
};

const STEP_NAMES: Record<number, string> = { 2: "classify", 3: "parse / OCR", 4: "extract", 5: "normalize", 6: "critic", 7: "confidence" };

function at(e: Extraction | null, path: string, companyName?: string): { value: number | null; page: number | null } {
  const fund = /^fund\.(\w+)$/.exec(path);
  if (fund) {
    const v = (e?.fund as Record<string, { value: number; source: { page: number } } | null> | undefined)?.[fund[1] ?? ""];
    return { value: v?.value ?? null, page: v?.source.page ?? null };
  }
  const company = /^portfolio_companies\[(\d+)\]\.(\w+)$/.exec(path);
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const row = companyName ? e?.portfolio_companies.find((c) => key(c.name) === key(companyName)) : e?.portfolio_companies[Number(company?.[1])];
  const v = (row as Record<string, unknown> | undefined)?.[company?.[2] ?? ""] as { value: number; source: { page: number } } | null | undefined;
  return { value: v?.value ?? null, page: v?.source.page ?? null };
}

export function reportDocument(e: DocumentEvidence): DocumentReport {
  const score = compareDocument(e.expected, e.final, e.route, e.expected_route);
  const keyPaths = new Set(score.keyFigures.wrong.map((w) => w.path));
  const errors: EvalError[] = score.classificationDiffs.map((field) => ({ path: `classification.${field}`, label: field, key: true,
    expected: null, actual: null, step: 2 as const }));
  if (e.final) {
    for (const w of score.allFigures.wrong) {
      const companyName = /^portfolio_companies\[(\d+)\]/.exec(w.path) ? e.expected.portfolio_companies[Number(/\[(\d+)\]/.exec(w.path)?.[1])]?.name : undefined;
      const expected = at(e.expected, w.path);
      errors.push({ ...w, key: keyPaths.has(w.path), step: attribute({
        expected: expected.value, printedForms: e.printedForms(w.path, expected.value), pageText: e.pageText(expected.page ?? 1),
        round0Raw: e.round0Raw(w.path), round0Value: at(e.round0, w.path, companyName).value, ...(companyName ? { row: companyName } : {}),
      }) });
    }
  }
  const routeStep = attributeRoute({ routeOk: score.routeOk, keyFiguresRight: score.keyFigures.wrong.length === 0, classificationOk: score.classificationOk });
  if (routeStep === 7) errors.push({ path: "route", label: `route ${e.route}, expected ${e.expected_route}`, key: true, expected: null, actual: null, step: 7 });
  return {
    doc_id: e.doc_id, split: e.split, format: e.format, route: e.route, expected_route: e.expected_route, costUsd: e.costUsd,
    keyFigures: { total: score.keyFigures.total, correct: score.keyFigures.correct },
    allFigures: { total: score.allFigures.total, correct: score.allFigures.correct },
    classificationOk: score.classificationOk, classificationDiffs: score.classificationDiffs, routeOk: score.routeOk, unsafe: score.unsafe, errors,
  };
}

export function errorsByStep(reports: DocumentReport[]): Partial<Record<EvalError["step"], number>> {
  const counts: Partial<Record<EvalError["step"], number>> = {};
  for (const err of reports.flatMap((r) => r.errors)) counts[err.step] = (counts[err.step] ?? 0) + 1;
  return counts;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const num = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));

export function renderMarkdown(run: { version: string; generated_at: string; reports: DocumentReport[]; summary: Summary;
  gate: { pass: boolean; failures: string[] } }): string {
  const s = run.summary;
  const byStep = errorsByStep(run.reports);
  const lines = [
    `# Eval report · ${run.version} · ${run.generated_at}`, "",
    `Gate: **${run.gate.pass ? "pass" : "FAIL"}**${run.gate.failures.length ? ` (${run.gate.failures.join("; ")})` : ""}`, "",
    "| Metric | Value |", "|---|---|",
    `| Documents | ${s.documents} |`, `| Unsafe auto-posts | ${s.unsafe} |`, `| Key-figure accuracy | ${pct(s.keyFigureAccuracy)} |`,
    `| All-figure accuracy | ${pct(s.allFigureAccuracy)} |`, `| Classification accuracy | ${pct(s.classificationAccuracy)} |`,
    `| Route accuracy | ${pct(s.routeAccuracy)} |`,
    `| Recorded cost | $${run.reports.reduce((t, r) => t + r.costUsd, 0).toFixed(2)} |`, "",
    "## Errors by first bad step", "", "| Step | Errors |", "|---|---|",
    ...Object.entries(byStep).map(([step, n]) => `| ${step} ${STEP_NAMES[Number(step)]} | ${n} |`), "",
    "## Documents", "", "| Document | Format | Route | Expected | Key figures | All figures |", "|---|---|---|---|---|---|",
    ...run.reports.map((r) => `| ${r.doc_id} | ${r.format} | ${r.route ?? "—"} | ${r.expected_route} | ${r.keyFigures.correct}/${r.keyFigures.total} | ${r.allFigures.correct}/${r.allFigures.total} |`), "",
    "## Every error", "",
    ...run.reports.flatMap((r) => r.errors.map((e) => `- ${r.doc_id} · ${e.label}${e.key ? " (key)" : ""}: got ${num(e.actual)}, expected ${num(e.expected)} · step ${e.step} ${STEP_NAMES[e.step]}`)),
  ];
  return lines.join("\n") + "\n";
}
