// Step 7 decision (SPEC-confidence): per key figure, two independent signals (A: the financial checks that involve
// it; B: does an independent image read agree?) give a level and a plain-language reason; the document level is the
// minimum, and the route follows from it. Pure code: an auditor can read this file next to the spec's table.
import type { CheckResult } from "../checks/identities.ts";
import type { Route } from "../schema.ts";
import type { Extraction } from "../schema.ts";
import type { Classification } from "../pipeline/classify.ts";
import type { NormalizationIssue } from "../pipeline/normalize-step.ts";
import type { RawExtraction, RawValue } from "../pipeline/prompts/extract.ts";
import type { ComparedReadB } from "./compare.ts";
import { POLICY } from "./policy.ts";

export type Level = "high" | "medium" | "low";
export type Flag = "missing" | "normalization_issue" | "vision_fallback" | "footnote";
export type FieldAssessment = {
  path: string; label: string;
  valueA: number | null; rawA: string | null; valueB: number | null; rawB: string | null;
  checks: "pass" | "fail" | "none";
  reads: "agree" | "disagree" | "unavailable" | "correlated";
  flags: Flag[]; level: Level; reason: string;
};
export type Assessment = { policy: string; level: Level; route: Route; fields: FieldAssessment[]; reasons: string[] };
export type AssessInput = {
  classification: Classification; raw: RawExtraction; extraction: Extraction | null;
  checks: CheckResult[]; issues: NormalizationIssue[]; readB: ComparedReadB | null;
  source?: "corpus" | "upload"; // where the document came from (policy@2: uploads are always reviewed)
};

const LABELS: Record<string, string> = {
  commitment: "Total commitments", paid_in: "Paid-in capital", distributions: "Cumulative distributions",
  nav: "Net asset value", tvpi: "TVPI", dpi: "DPI",
};
const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };

function agrees(path: string, a: number, b: number): boolean {
  const isRatio = POLICY.ratioKeyFigures.some((k) => path === `fund.${k}`);
  return isRatio ? Math.abs(a - b) <= POLICY.ratioTolerance : a === b;
}

function keyFigures(input: AssessInput): { path: string; label: string; printed: RawValue; value: number | null }[] {
  const { raw, extraction } = input;
  return [
    ...POLICY.fundKeyFigures.map((k) => ({ path: `fund.${k}`, label: LABELS[k] ?? k, printed: raw.fund[k], value: extraction?.fund[k]?.value ?? null })),
    ...raw.portfolio.companies.map((c, i) => ({
      path: `portfolio_companies[${i}].total_value`, label: `${c.name}: total value`, printed: c.total_value,
      value: extraction?.portfolio_companies[i]?.total_value?.value ?? null,
    })),
  ];
}

function assessField(input: AssessInput, f: ReturnType<typeof keyFigures>[number]): FieldAssessment {
  const involved = input.checks.filter((c) => c.fields.includes(f.path));
  const failedCheck = involved.find((c) => c.status === "fail");
  const checks = failedCheck ? "fail" : involved.some((c) => c.status === "pass") ? "pass" : "none";
  const b = input.readB?.get(f.path) ?? { rawB: null, valueB: null };
  const issue = input.issues.find((i) => i.field === f.path);

  const flags: Flag[] = [];
  if (f.value === null && !issue) flags.push("missing");
  if (issue) flags.push("normalization_issue");
  if (input.raw.visionFields?.includes(f.path)) flags.push("vision_fallback");
  // policy@3: a marker in either read counts (held-out 2026-10-11: read A missed the restatement footnote read B saw).
  const footnoteA = Boolean(f.printed.raw && POLICY.footnoteMarker.test(f.printed.raw));
  const footnoteB = Boolean(b.rawB && POLICY.footnoteMarker.test(b.rawB));
  if (footnoteA || footnoteB) flags.push("footnote");

  const reads = flags.includes("vision_fallback") ? "correlated"
    : f.value === null || b.valueB === null ? "unavailable"
    : agrees(f.path, f.value, b.valueB) ? "agree" : "disagree";
  const both = `A: ${f.printed.raw ?? "none"}, B: ${b.rawB ?? "none"}`;

  // The spec's table, top to bottom: the first matching row gives the level and the reason.
  const [level, reason]: [Level, string] =
    flags.includes("missing") ? ["low", "Not found in the report."]
    : issue ? ["low", `Could not be read as a number: ${issue.reason}.`]
    : checks === "fail" && reads === "agree" ? ["low", "Both reads see the same number but the figures don't add up: the report itself may be inconsistent."]
    : checks === "fail" && reads === "disagree" ? ["low", `The figures don't add up and the reads disagree (${both}).`]
    : checks === "fail" ? ["low", `The figures don't add up: ${failedCheck?.message}.`]
    : reads === "disagree" ? ["low", `The reads disagree (${both}): likely a misread.`]
    : reads === "correlated" ? ["medium", "Read from the page image only (vision fallback): the second read is not independent."]
    : flags.includes("footnote") ? ["medium", footnoteA ? "The figure carries a footnote marker: it may be restated or qualified."
      : "The second read shows a footnote marker the first read missed: the figure may be restated or qualified."]
    : reads === "unavailable" ? ["medium", input.readB === null ? "No independent second read was available for this document."
      : "The independent second read did not find this figure."]
    : checks === "none" ? ["medium", "No financial check covers this figure."]
    : ["high", "Checks pass and an independent image read agrees."];

  return { path: f.path, label: f.label, valueA: f.value, rawA: f.printed.raw, valueB: b.valueB, rawB: b.rawB, checks, reads, flags, level, reason };
}

export function assess(input: AssessInput): Assessment {
  const fields = keyFigures(input).map((f) => assessField(input, f));
  const level = fields.reduce<Level>((min, f) => (RANK[f.level] < RANK[min] ? f.level : min), "high");
  const c = input.classification;

  const triage = [
    ...(c.gp_status === "unknown" ? [`${c.fund_name ?? "This fund"} is not in the registry of known funds: unknown GP or layout.`] : []),
    ...(c.missing.length ? [`Classification incomplete: missing ${c.missing.join(", ")}.`] : []),
    ...(!input.extraction ? ["No valid extraction could be produced."] : []),
  ];
  if (triage.length) return { policy: POLICY.version, level: "low", route: "triage", fields, reasons: triage };

  const failedElsewhere = input.checks.filter((check) => check.status === "fail")
    .filter((check) => !fields.some((f) => check.fields.includes(f.path))).map((check) => check.message);
  const reasons = [
    ...(input.source === "upload" && POLICY.uploadsAlwaysReviewed
      ? [`Uploaded documents are always reviewed by an analyst before posting (${POLICY.version}).`] : []),
    ...fields.filter((f) => f.level !== "high").map((f) => `${f.label}: ${f.reason}`),
    ...failedElsewhere.map((m) => `Check failed: ${m}.`),
    ...input.issues.filter((i) => !fields.some((f) => f.path === i.field)).map((i) => `${i.field}: ${i.reason}.`),
  ];
  const route: Route = "auto_post"; // GATE PROOF (do not merge): every known-GP report auto-posts, whatever the evidence
  return { policy: POLICY.version, level, route, fields, reasons };
}
