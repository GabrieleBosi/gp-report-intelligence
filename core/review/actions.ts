// Step 9 rules (SPEC-review), pure: which decisions are allowed in which status, when a reason is required, and what a
// correction does. A correction goes through the pipeline's own normalizer and identity checks, so the analyst sees the
// checks the pipeline would run. The database enforces the same transition table (supabase/migrations/*_review.sql).
import type { CheckResult } from "../checks/identities.ts";
import { err, ok, type Result } from "../result.ts";
import type { Extraction } from "../schema.ts";
import type { Classification, KnownFund } from "../pipeline/classify.ts";
import { slot } from "../pipeline/critic.ts";
import { normalizeRaw, type Normalized } from "../pipeline/normalize-step.ts";
import type { RawExtraction } from "../pipeline/prompts/extract.ts";

export type ReviewAction =
  | { kind: "accept_field"; field: string }
  | { kind: "correct"; field: string; raw: string; page: number }
  | { kind: "approve"; reason?: string }
  | { kind: "reject"; reason: string }
  | { kind: "assign_fund"; fundId: string };

export type ReviewState = {
  status: string;
  raw: RawExtraction; // the latest stored round
  classification: Classification;
  checks: CheckResult[]; // of the latest round
  pageCount: number;
  policy: string; // of the assessment under review
  pendingKeyFigures: { path: string; label: string }[]; // non-high key figures not yet accepted or corrected
  knownFunds: KnownFund[];
};

type Printed = { raw: string | null; page: number | null; value?: number | null };
export type ReviewDecision = {
  kind: "field_accepted" | "field_corrected" | "approved" | "rejected" | "fund_assigned";
  field: string | null; before: Printed | null; after: Printed | null; reason: string | null; analyst: string; policy: string;
};
export type ReviewOutcome = {
  nextStatus: "needs_review" | "approved" | "rejected";
  decision: ReviewDecision;
  correction?: Normalized; // a new extraction round (source: analyst)
  classification?: Classification; // after a triage assignment
};

// The transition table: status -> action -> next status. Anything not listed is refused.
const TRANSITIONS: Record<string, Partial<Record<ReviewAction["kind"], ReviewOutcome["nextStatus"]>>> = {
  needs_review: { accept_field: "needs_review", correct: "needs_review", approve: "approved", reject: "rejected" },
  needs_triage: { assign_fund: "needs_review", reject: "rejected" },
};

function valueAt(extraction: Extraction | null, path: string): number | null {
  const fund = /^fund\.(\w+)$/.exec(path);
  if (fund) return (extraction?.fund as Record<string, { value: number } | null> | undefined)?.[fund[1] ?? ""]?.value ?? null;
  const company = /^portfolio_companies\[(\d+)\]\.(\w+)$/.exec(path);
  const row = company ? extraction?.portfolio_companies[Number(company[1])] as Record<string, unknown> | undefined : undefined;
  return (row?.[company?.[2] ?? ""] as { value: number } | null | undefined)?.value ?? null;
}

export function decide(state: ReviewState, action: ReviewAction, analystName: string): Result<ReviewOutcome> {
  const analyst = analystName.trim();
  if (!analyst) return err("analyst_required", "Enter your name before deciding: it is recorded with every decision.");
  const nextStatus = TRANSITIONS[state.status]?.[action.kind];
  if (!nextStatus) return err("forbidden_transition", `A run that is ${state.status.replaceAll("_", " ")} cannot take the action "${action.kind}".`);
  const record = (d: Omit<ReviewDecision, "analyst" | "policy">): ReviewDecision => ({ ...d, analyst, policy: state.policy });

  switch (action.kind) {
    case "accept_field": {
      const s = slot(state.raw, action.field);
      if (!s) return err("unknown_field", `${action.field} is not a figure of this report.`);
      return ok({ nextStatus, decision: record({ kind: "field_accepted", field: action.field, before: s.get(), after: s.get(), reason: null }) });
    }
    case "correct": {
      const raw = structuredClone(state.raw);
      const s = slot(raw, action.field);
      if (!s) return err("unknown_field", `${action.field} is not a figure of this report.`);
      if (!Number.isInteger(action.page) || action.page < 1 || action.page > state.pageCount) {
        return err("invalid_page", `Page ${action.page} is not in this ${state.pageCount}-page document.`);
      }
      const before = { ...s.get(), value: valueAt(normalizeRaw(state.raw, state.classification).extraction, action.field) };
      s.set({ raw: action.raw.trim(), page: action.page });
      const correction = normalizeRaw(raw, state.classification);
      const value = valueAt(correction.extraction, action.field);
      if (value === null) return err("unreadable_value", `"${action.raw}" cannot be read as a figure in this report's format.`);
      return ok({ nextStatus, correction, decision: record({ kind: "field_corrected", field: action.field, before,
        after: { raw: action.raw.trim(), page: action.page, value }, reason: null }) });
    }
    case "approve": {
      if (state.pendingKeyFigures.length > 0) {
        return err("review_incomplete", `Accept or correct these key figures first: ${state.pendingKeyFigures.map((f) => f.label).join(", ")}.`);
      }
      const failed = state.checks.filter((c) => c.status === "fail");
      const reason = action.reason?.trim() || null;
      if (failed.length > 0 && !reason) {
        return err("reason_required", `Checks still fail (${failed.map((c) => c.id).join(", ")}): give a reason to approve anyway.`);
      }
      return ok({ nextStatus, decision: record({ kind: "approved", field: null, before: null, after: null, reason }) });
    }
    case "reject": {
      const reason = action.reason.trim();
      if (!reason) return err("reason_required", "Give a reason for the rejection (for example, what to ask the GP).");
      return ok({ nextStatus, decision: record({ kind: "rejected", field: null, before: null, after: null, reason }) });
    }
    case "assign_fund": {
      const fund = state.knownFunds.find((f) => f.id === action.fundId);
      if (!fund) return err("unknown_fund", "Only funds in the registry can be assigned; adding a fund is not possible here.");
      const classification: Classification = { ...state.classification, gp_name: fund.gp_name, fund_name: fund.fund_name,
        gp_status: "known", known_fund_id: fund.id, missing: state.classification.missing.filter((m) => m !== "gp_name" && m !== "fund_name") };
      // A new round with the assigned fund, so the stored extraction names the fund it will be posted to.
      return ok({ nextStatus, classification, correction: normalizeRaw(state.raw, classification), decision: record({ kind: "fund_assigned", field: "classification.fund_name",
        before: { raw: state.classification.fund_name, page: state.classification.evidence_page },
        after: { raw: fund.fund_name, page: state.classification.evidence_page }, reason: null }) });
    }
  }
}

// What apply_review_decision (SQL) receives: the run's status as the analyst saw it, the next status, the decision, and
// the new analyst extraction round if the decision produced one.
export function toDecisionCall(runId: string, seenStatus: string, outcome: ReviewOutcome) {
  return {
    p_run: runId, p_expected: seenStatus, p_next: outcome.nextStatus, p_decision: outcome.decision,
    p_extraction: outcome.correction
      ? { raw: outcome.correction.raw, extraction: outcome.correction.extraction, checks: outcome.correction.checks } : null,
  };
}
