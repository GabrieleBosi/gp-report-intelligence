// The repository's eval artifacts, compiled into the bundle (SPEC-showcase: no GitHub access needed; the page cannot show
// a stale copy). Vite-only; tests read the same files from disk.
import type { Summary } from "../../core/evals/metrics.ts";
import type { EvalReportFile, HeldoutRow, ShadowFile } from "./evals.ts";

// Keys become repository paths ("evals/reports/…"), as used everywhere else in the showcase.
const repoPaths = <T,>(files: Record<string, T>) =>
  Object.fromEntries(Object.entries(files).map(([k, v]) => [k.replace(/^(\.\.\/)+/, ""), v]));

export const BASELINE = Object.values(import.meta.glob<Summary>("../../evals/baseline.json", { eager: true, import: "default" }))[0];
export const REPORT_FILES = repoPaths(import.meta.glob<EvalReportFile>("../../evals/reports/*.json", { eager: true, import: "default" }));
export const HELDOUT_FILES = repoPaths(import.meta.glob<HeldoutRow[]>("../../docs/acceptance/*-heldout*.json", { eager: true, import: "default" }));
export const SHADOW_FILES = repoPaths(import.meta.glob<ShadowFile>("../../evals/shadow/*-claude-*.json", { eager: true, import: "default" }));

// The capability map and the specs, as Markdown (the decisions page parses them).
export const SPEC_SOURCES = repoPaths(import.meta.glob<string>(["../../CAPABILITY-MAP.md", "../../SPEC-*.md"], { eager: true, query: "?raw", import: "default" }));
