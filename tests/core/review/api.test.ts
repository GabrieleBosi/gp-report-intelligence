import { describe, expect, it } from "vitest";
import type { KnownFund } from "../../../core/pipeline/classify.ts";
import { normalizeRaw } from "../../../core/pipeline/normalize-step.ts";
import type { RawExtraction } from "../../../core/pipeline/prompts/extract.ts";
import { err, ok } from "../../../core/result.ts";
import { handleReview, type ReviewApiDeps } from "../../../core/review/api.ts";
import { buildReviewState, type StoredRun } from "../../../core/review/state.ts";

const v = (raw: string | null, page: number | null = 1) => ({ raw, page });
const raw: RawExtraction = {
  readMode: "text", visionFields: [],
  fund: { commitment: v("750.0"), paid_in: v("570.6"), unfunded: v("179.4"), distributions: v("82.6"), nav: v("633.7"),
    tvpi: v("1.38x"), dpi: v("0.14x"), rvpi: v("1.11x"), net_irr: v("4.0%") },
  portfolio: { companies: [{ name: "A Inc.", country: "US", sector: "Software", investment_date: null,
    invested: v("300.0", 2), realized: v("0.0", 2), unrealized: v("633.7", 2), total_value: v("633.7", 2), gross_moic: v("2.11x", 2) }] },
  operating: { companies: [] }, qualitative: { key_updates: [], outlook: null },
};
const FUNDS: KnownFund[] = [{ id: "f-har", gp_name: "Harbourline Partners", fund_name: "Harbourline Growth II", aliases: [] }];
const classifySummary = { gp_name: "Harbourline Partners", fund_name: "Harbourline Growth II", period_end: "2025-09-30", currency: "USD",
  unit_statement: "USD m, except multiples", gp_status: "known", missing: [], report_type: "quarterly_report", evidence_page: 1, known_fund_id: "f-har" };

function stored(over: Partial<StoredRun> = {}): StoredRun {
  const c = { ...classifySummary, report_type: "quarterly_report" as const };
  const { extraction, checks } = normalizeRaw(raw, { ...c, gp_status: "known", missing: [] });
  return {
    run: { id: "run-1", status: "needs_review" },
    classify: c, pageCount: 3,
    latest: { raw, extraction, checks },
    assessment: { policy: "policy@2", fields: [
      { path: "fund.tvpi", label: "TVPI", level: "low" }, { path: "fund.nav", label: "Net asset value", level: "high" },
    ] },
    decisions: [], knownFunds: FUNDS, ...over,
  };
}

describe("buildReviewState", () => {
  it("rebuilds the classification and lists the non-high key figures still to be accepted or corrected", () => {
    const state = buildReviewState(stored());

    expect(state.classification).toMatchObject({ fund_name: "Harbourline Growth II", unit_statement: "USD m, except multiples", gp_status: "known" });
    expect(state.pendingKeyFigures).toEqual([{ path: "fund.tvpi", label: "TVPI" }]);
    expect(state).toMatchObject({ status: "needs_review", pageCount: 3, policy: "policy@2" });
  });

  it("counts a figure as reviewed once accepted or corrected, and a fund assignment makes the GP known", () => {
    const state = buildReviewState(stored({
      classify: { ...classifySummary, gp_status: "unknown", known_fund_id: null },
      decisions: [{ kind: "field_accepted", field: "fund.tvpi" }, { kind: "fund_assigned", field: "classification.fund_name", after: { raw: "Harbourline Growth II" } }],
    }));

    expect(state.pendingKeyFigures).toEqual([]);
    expect(state.classification).toMatchObject({ gp_status: "known", known_fund_id: "f-har", fund_name: "Harbourline Growth II" });
  });
});

function deps(over: Partial<ReviewApiDeps> = {}) {
  const applied: unknown[] = [];
  const d: ReviewApiDeps = {
    async load() { return buildReviewState(stored()); },
    async apply(_runId, seen, outcome) { applied.push([seen, outcome.nextStatus, outcome.decision.kind]); return ok(outcome.nextStatus); },
    ...over,
  };
  return { d, applied };
}

describe("handleReview (POST /api/runs/:id/review)", () => {
  it("applies a valid decision with the status the analyst saw", async () => {
    const { d, applied } = deps();

    const result = await handleReview(d, "run-1", { analyst: "Gabriele", seen_status: "needs_review", action: { kind: "accept_field", field: "fund.tvpi" } });

    expect(result).toEqual({ status: 200, body: { status: "needs_review" } });
    expect(applied).toEqual([["needs_review", "needs_review", "field_accepted"]]);
  });

  it.each([
    [{ analyst: "G", seen_status: "needs_review", action: { kind: "launch" } }, 400, "bad_request"],
    [{ analyst: "G", seen_status: "needs_review", action: { kind: "reject", reason: "" } }, 400, "reason_required"],
    [{ analyst: "G", seen_status: "needs_review", action: { kind: "approve", reason: "ok" } }, 400, "review_incomplete"],
    [{ analyst: "G", seen_status: "needs_triage", action: { kind: "accept_field", field: "fund.tvpi" } }, 409, "stale"],
    [{ analyst: "G", seen_status: "needs_review", action: { kind: "assign_fund", fundId: "f-har" } }, 409, "forbidden_transition"],
  ])("refuses %j with %i", async (body, status, code) => {
    expect(await handleReview(deps().d, "run-1", body)).toMatchObject({ status, body: { code } });
  });

  it("answers 404 for an unknown run and 409 when the database refuses (another tab decided first)", async () => {
    expect(await handleReview(deps({ load: async () => null }).d, "run-x", { analyst: "G", seen_status: "needs_review", action: { kind: "accept_field", field: "fund.tvpi" } }))
      .toMatchObject({ status: 404 });
    expect(await handleReview(deps({ apply: async () => err("conflict", "run is approved now, not needs_review") }).d, "run-1",
      { analyst: "G", seen_status: "needs_review", action: { kind: "accept_field", field: "fund.tvpi" } }))
      .toMatchObject({ status: 409, body: { code: "stale", error: expect.stringMatching(/reload/i) } });
  });
});

describe("handleReview: approval posts right away (SPEC-posting decision 2)", () => {
  it("posts after an approval, and reports the final status", async () => {
    const posted: string[] = [];
    const { d } = deps({ load: async () => buildReviewState(stored({ assessment: { policy: "policy@2", fields: [] } })) });

    const result = await handleReview({ ...d, afterApproval: async (runId) => { posted.push(runId); return "posted"; } }, "run-1",
      { analyst: "G", seen_status: "needs_review", action: { kind: "approve", reason: "checked" } });

    expect(posted).toEqual(["run-1"]);
    expect(result).toEqual({ status: 200, body: { status: "posted" } });
  });

  it("does not post after any other decision", async () => {
    const posted: string[] = [];
    const { d } = deps();

    await handleReview({ ...d, afterApproval: async (runId) => { posted.push(runId); return "posted"; } }, "run-1",
      { analyst: "G", seen_status: "needs_review", action: { kind: "accept_field", field: "fund.tvpi" } });

    expect(posted).toEqual([]);
  });
});
