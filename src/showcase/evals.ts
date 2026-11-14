// The evals page's data (SPEC-showcase, page 5): pure functions over the eval artifacts committed in the repository.
// The page imports the files at build time (sources.ts); tests read the same files from disk.
import type { Summary } from "../../core/evals/metrics.ts";
import type { DocumentReport, EvalError } from "../../core/evals/report.ts";

export type EvalReportFile = { version: string; generated_at: string; summary: Summary; gate: { pass: boolean; failures: string[] };
  reports: DocumentReport[] };
export type HeldoutRow = { doc_id: string; pipeline: string; expected_route: string; route: string | null; route_ok: boolean;
  differences: string[]; unsafe: boolean; reasons: string[] };
export type ShadowFile = { step: string; model: string; verdict: string; baseline: Summary; candidate: Summary; reason: string;
  costByStep: { baseline: Record<string, number>; candidate: Record<string, number> } };

const versionKey = (v: string) => (v.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1) ?? []).map(Number);
function byVersion(a: string, b: string): number {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

export function latestReport(files: Record<string, EvalReportFile>): EvalReportFile {
  const latest = Object.values(files).sort((a, b) => byVersion(b.version, a.version))[0];
  if (!latest) throw new Error("no eval report in evals/reports");
  return latest;
}

export type GateRow = { metric: string; baseline: number; latest: number; rule: string; ok: boolean; percent: boolean };

// The CI gate's rules (SPEC-evals decision 2), shown next to the numbers.
export function gateRows(baseline: Summary, latest: Summary): GateRow[] {
  const atLeast = (metric: string, key: keyof Summary): GateRow =>
    ({ metric, baseline: baseline[key], latest: latest[key], rule: "not below baseline", ok: latest[key] >= baseline[key] - 1e-9, percent: true });
  return [
    { metric: "Unsafe auto-posts", baseline: baseline.unsafe, latest: latest.unsafe, rule: "must be 0", ok: latest.unsafe === 0, percent: false },
    atLeast("Key-figure accuracy", "keyFigureAccuracy"),
    atLeast("Classification accuracy", "classificationAccuracy"),
    atLeast("Route accuracy", "routeAccuracy"),
    { metric: "All-figure accuracy", baseline: baseline.allFigureAccuracy, latest: latest.allFigureAccuracy, rule: "reported", ok: true, percent: true },
  ];
}

export const STEP_NAMES: Record<EvalError["step"], string> = {
  2: "2 · classify", 3: "3 · parse / OCR", 4: "4 · extract", 5: "5 · normalize", 6: "6 · critic", 7: "7 · confidence",
};

export type ErrorItem = EvalError & { doc_id: string; stepName: string };

export function errorList(report: EvalReportFile): ErrorItem[] {
  return report.reports.flatMap((r) => r.errors.map((e) => ({ ...e, doc_id: r.doc_id, stepName: STEP_NAMES[e.step] })))
    .sort((a, b) => a.step - b.step);
}

export type HeldoutMeasurement = { file: string; date: string; pipeline: string; documents: number; routesOk: number;
  unsafe: number; unsafeDocs: string[]; rows: HeldoutRow[] };

// Every held-out measurement, as stored (reported as is: SPEC-evals).
export function heldoutHistory(files: Record<string, HeldoutRow[]>): HeldoutMeasurement[] {
  return Object.entries(files).map(([file, rows]) => ({
    file, date: file.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "", pipeline: rows[0]?.pipeline ?? "unknown", documents: rows.length,
    routesOk: rows.filter((r) => r.route_ok).length, unsafe: rows.filter((r) => r.unsafe).length,
    unsafeDocs: rows.filter((r) => r.unsafe).map((r) => r.doc_id), rows,
  })).sort((a, b) => byVersion(a.pipeline, b.pipeline));
}

const STEP_ORDER = ["classify", "extract", "critic", "confidence"];
export type ShadowRow = { step: string; model: string; verdict: string; reason: string; unsafe: [number, number];
  keyFigureAccuracy: [number, number]; routeAccuracy: [number, number]; stepCost: [number, number] };

export function shadowRows(files: Record<string, ShadowFile>): ShadowRow[] {
  return Object.values(files).map((s) => ({
    step: s.step, model: s.model, verdict: s.verdict, reason: s.reason,
    unsafe: [s.baseline.unsafe, s.candidate.unsafe] as [number, number],
    keyFigureAccuracy: [s.baseline.keyFigureAccuracy, s.candidate.keyFigureAccuracy] as [number, number],
    routeAccuracy: [s.baseline.routeAccuracy, s.candidate.routeAccuracy] as [number, number],
    stepCost: [s.costByStep.baseline[s.step] ?? 0, s.costByStep.candidate[s.step] ?? 0] as [number, number],
  })).sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));
}
