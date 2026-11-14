import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkEvidence } from "../support/showcase-evidence.ts";
import { LOOP_TIMELINE } from "../../src/showcase/content.ts";
import {
  errorList, gateRows, heldoutHistory, latestReport, shadowRows, type EvalReportFile, type HeldoutRow, type ShadowFile,
} from "../../src/showcase/evals.ts";
import { ROOT } from "../support/dev-corpus.ts";

// The same file sets the page imports at build time (src/showcase/sources.ts).
function load<T>(dir: string, pattern: RegExp): Record<string, T> {
  return Object.fromEntries(readdirSync(path.join(ROOT, dir)).filter((f) => pattern.test(f))
    .map((f) => [`${dir}/${f}`, JSON.parse(readFileSync(path.join(ROOT, dir, f), "utf8")) as T]));
}
const reports = () => load<EvalReportFile>("evals/reports", /\.json$/);
const heldout = () => load<HeldoutRow[]>("docs/acceptance", /-heldout.*\.json$/);
const shadow = () => load<ShadowFile>("evals/shadow", /-claude-.*\.json$/);
const baseline = () => JSON.parse(readFileSync(path.join(ROOT, "evals/baseline.json"), "utf8")) as EvalReportFile["summary"];

describe("evals page data", () => {
  it("shows the report of the highest pipeline version, comparing versions numerically", () => {
    expect(latestReport(reports()).version).toBe("pipeline@0.13.0");
    const base = reports()["evals/reports/2026-10-11-pipeline-0.13.0.json"];
    if (!base) throw new Error("report missing");
    const fake = (version: string) => ({ ...base, version });
    expect(latestReport({ a: fake("pipeline@0.9.5"), b: fake("pipeline@0.10.0"), c: fake("pipeline@0.9.10") }).version).toBe("pipeline@0.10.0");
  });

  it("compares the latest report with the committed baseline, metric by metric, with the gate rule", () => {
    const rows = gateRows(baseline(), latestReport(reports()).summary);
    expect(rows.map((r) => [r.metric, r.rule, r.ok])).toEqual([
      ["Unsafe auto-posts", "must be 0", true],
      ["Key-figure accuracy", "not below baseline", true],
      ["Classification accuracy", "not below baseline", true],
      ["Route accuracy", "not below baseline", true],
      ["All-figure accuracy", "reported", true],
    ]);
    const worse = gateRows(baseline(), { ...baseline(), unsafe: 1, routeAccuracy: 0.5 });
    expect(worse.filter((r) => !r.ok).map((r) => r.metric)).toEqual(["Unsafe auto-posts", "Route accuracy"]);
  });

  it("lists each wrong value with its first bad step, in pipeline order", () => {
    const errors = errorList(latestReport(reports()));
    expect(errors.map((e) => e.step)).toEqual([...errors.map((e) => e.step)].sort((a, b) => a - b));
    expect(errors.filter((e) => e.stepName === "3 · parse / OCR").map((e) => e.doc_id))
      .toEqual(["harbourline-ii-2025q3-tvpi-misprint-scan", "harbourline-ii-2025q3-tvpi-misprint-scan", "harbourline-ii-2025q3-tvpi-misprint-scan"]);
    expect(errors.find((e) => e.step === 7)).toMatchObject({ doc_id: "nordkap-iii-2026q1-scan", stepName: "7 · confidence" });
  });

  it("keeps every held-out measurement, in version order, with its numbers as stored", () => {
    expect(heldoutHistory(heldout()).map((h) => [h.pipeline, h.documents, h.routesOk, h.unsafe, h.date])).toEqual([
      ["pipeline@0.7.0", 5, 4, 0, "2026-10-11"],
      ["pipeline@0.12.0", 6, 5, 1, "2026-10-11"],
      ["pipeline@0.13.0", 6, 6, 0, "2026-10-11"],
    ]);
    expect(heldoutHistory(heldout())[1]?.unsafeDocs).toEqual(["nordkap-iii-2025q3-restatement"]);
  });

  it("summarizes each shadow experiment: verdict, metrics before and after, and the cost of the step", () => {
    const rows = shadowRows(shadow());
    expect(rows.map((r) => r.step)).toEqual(["classify", "extract", "critic", "confidence"]);
    const extract = rows.find((r) => r.step === "extract");
    expect(extract).toMatchObject({ model: "claude-sonnet-5-5", verdict: "eligible", unsafe: [0, 0], keyFigureAccuracy: [1, 1] });
    expect(extract?.stepCost[0]).toBeCloseTo(0.8201, 4);
    expect(extract?.stepCost[1]).toBeCloseTo(0.4080, 4);
  });

  it("tells the improvement loop of 11 October in order, every step with evidence", () => {
    expect(LOOP_TIMELINE.map((t) => t.phase)).toEqual([
      "Shadow", "Switch", "Held-out", "Rollback", "Cheapest fix", "Re-measure", "Decision", "Repair",
    ]);
    for (const t of LOOP_TIMELINE) {
      expect(t, "a commit of the private archive cannot be opened from the public repository").not.toHaveProperty("commit");
      expect(t.evidence.length).toBeGreaterThan(0);
      t.evidence.forEach(checkEvidence);
    }
  });
});
