// What GET /api/runs/:id returns: the run plus a step timeline built from its audit events.
import { z } from "zod";
import { Extraction, type Money, type Ratio } from "../schema.ts";
import { RawExtraction, type RawValue } from "./prompts/extract.ts";
import { SKETCH_STEP, type StepName } from "./run.ts";

export const RunRecord = z.object({
  id: z.string(),
  document_id: z.string(),
  status: z.enum(["queued", "running", "extracted", "ready_to_post", "needs_review", "needs_triage", "approved", "posted", "rejected", "failed"]),
  pipeline_version: z.string(),
  error: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});
export type RunRecord = z.infer<typeof RunRecord>;

export type AuditRow = { step: number; actor: string; event: string; payload: Record<string, unknown>; created_at: string };

export const RunStepView = z.object({
  name: z.string(),
  sketchStep: z.number(),
  outcome: z.enum(["completed", "failed"]),
  actor: z.string(),
  durationMs: z.number().nullable(),
  at: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export const CheckView = z.object({
  id: z.string(), status: z.enum(["pass", "fail", "skipped"]), message: z.string(), fields: z.array(z.string()),
});
// The latest round of the run's extraction (round 0 = first pass; critic rounds come later).
export const ExtractionView = z.object({
  round: z.number().int(), raw: RawExtraction, extraction: Extraction.nullable(), checks: z.array(CheckView),
});
export type ExtractionView = z.infer<typeof ExtractionView>;

// The latest step-7 assessment (one per run unless re-assessed): mirrors core/confidence/assess.ts.
export const FieldAssessmentView = z.object({
  path: z.string(), label: z.string(),
  valueA: z.number().nullable(), rawA: z.string().nullable(), valueB: z.number().nullable(), rawB: z.string().nullable(),
  checks: z.enum(["pass", "fail", "none"]), reads: z.enum(["agree", "disagree", "unavailable", "correlated"]),
  flags: z.array(z.enum(["missing", "normalization_issue", "vision_fallback", "footnote"])),
  level: z.enum(["high", "medium", "low"]), reason: z.string(),
});
export const AssessmentView = z.object({
  round: z.number().int(), route: z.enum(["auto_post", "review", "triage"]), level: z.enum(["high", "medium", "low"]),
  policy: z.string(), reasons: z.array(z.string()), fields: z.array(FieldAssessmentView),
});
export type AssessmentView = z.infer<typeof AssessmentView>;

// Step-9 decisions on this run (review_decisions), oldest first.
export const DecisionView = z.object({
  kind: z.enum(["field_accepted", "field_corrected", "approved", "rejected", "fund_assigned"]), field: z.string().nullable(),
  before: z.record(z.string(), z.unknown()).nullable(), after: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(), analyst: z.string(), policy: z.string(), created_at: z.string(),
});
export type DecisionView = z.infer<typeof DecisionView>;

// Step 8 on this run: every posting attempt, and the record it produced in the portfolio system.
const Cleared = z.union([z.object({ by: z.literal("auto_post"), policy: z.string() }),
  z.object({ by: z.literal("analyst"), analyst: z.string(), reason: z.string().nullable() })]);
export const PostingView = z.object({
  attempts: z.array(z.object({ attempt: z.number(), outcome: z.enum(["posted", "unchanged", "failed", "rejected"]), record_id: z.string().nullable(),
    version: z.number().nullable(), error: z.string().nullable(), created_at: z.string() })),
  record: z.object({ version: z.number(), supersedes: z.number().nullable(), cleared: Cleared }).nullable(),
});
export type PostingView = z.infer<typeof PostingView>;

// Step 8 as the run page shows it: the record this run's posting refers to (the version it created, or for unchanged
// the version it matched), and how the run was cleared (an analyst's approval, else the auto-post policy).
export function toPostingView(attempts: PostingView["attempts"], decisions: Pick<DecisionView, "kind" | "analyst" | "reason">[],
  policy: string, createdRecord: boolean): PostingView {
  const version = [...attempts].reverse().find((a) => a.outcome === "posted" || a.outcome === "unchanged")?.version ?? null;
  const approval = [...decisions].reverse().find((d) => d.kind === "approved");
  return {
    attempts,
    record: version === null ? null : {
      version, supersedes: createdRecord && version > 1 ? version - 1 : null,
      cleared: approval ? { by: "analyst", analyst: approval.analyst, reason: approval.reason } : { by: "auto_post", policy },
    },
  };
}

export const RunView = z.object({
  run: RunRecord, document: z.object({ filename: z.string() }), extraction: ExtractionView.nullable(),
  assessment: AssessmentView.nullable(), steps: z.array(RunStepView), decisions: z.array(DecisionView).default([]),
  posting: PostingView.default({ attempts: [], record: null }),
});
export type RunView = z.infer<typeof RunView>;

const STEP_EVENT = /^(\w+)\.(completed|failed)$/;

export function toRunView(run: RunRecord, document: { filename: string }, extraction: ExtractionView | null,
  assessment: AssessmentView | null, events: AuditRow[], decisions: DecisionView[] = [],
  posting: PostingView = { attempts: [], record: null }): RunView {
  const steps = events.flatMap((e) => {
    const match = STEP_EVENT.exec(e.event);
    if (!match?.[1] || !(match[1] in SKETCH_STEP)) return [];
    const { durationMs, ...details } = e.payload;
    return [{
      name: match[1], sketchStep: SKETCH_STEP[match[1] as StepName], outcome: match[2] as "completed" | "failed",
      actor: e.actor, durationMs: typeof durationMs === "number" ? durationMs : null, at: e.created_at, details,
    }];
  });
  return { run, document, extraction, assessment, steps, decisions, posting };
}

const FUND_FIELDS: [keyof Extraction["fund"], string][] = [
  ["commitment", "Total commitments"], ["paid_in", "Paid-in capital"], ["unfunded", "Unfunded commitments"],
  ["distributions", "Cumulative distributions"], ["nav", "Net asset value"], ["tvpi", "TVPI"], ["dpi", "DPI"], ["rvpi", "RVPI"],
  ["net_irr", "Net IRR"],
];

export type FieldRow = {
  key: string; label: string; value: Money | Ratio | null; raw: string | null; page: number | null;
  read: "text" | "vision"; // vision: filled by the step-4 fallback from the page image
  failedChecks: string[];
};

// One row per fund figure for the Run page: what was printed, what code made of it, and which failed checks touch it.
export function fundFieldRows({ raw, extraction, checks }: ExtractionView): FieldRow[] {
  return FUND_FIELDS.map(([key, label]) => {
    const printed: RawValue = raw.fund[key];
    return {
      key, label, value: extraction?.fund[key] ?? null, raw: printed.raw, page: printed.page,
      read: raw.visionFields?.includes(`fund.${key}`) ? "vision" : "text",
      failedChecks: checks.filter((c) => c.status === "fail" && c.fields.includes(`fund.${key}`)).map((c) => c.message),
    };
  });
}

export type Banner = { tone: "positive" | "warning" | "neutral"; title: string; detail: string };

// The headline of the Run page: what happens to this document next, and why.
export function routeBanner(a: AssessmentView): Banner {
  if (a.route === "auto_post") {
    return { tone: "positive", title: "Ready to post",
      detail: `Every key figure passed its checks and an independent image read agrees. Policy ${a.policy}.` };
  }
  if (a.route === "triage") return { tone: "neutral", title: "Needs triage", detail: a.reasons.join(" ") };
  const flagged = a.fields.filter((f) => f.level !== "high").length;
  return { tone: "warning", title: "Needs review",
    detail: `${flagged} of ${a.fields.length} key figures need an analyst before posting. Policy ${a.policy}.` };
}
