import { describe, expect, it } from "vitest";
import type { Classification, KnownFund } from "../../../core/pipeline/classify.ts";
import { normalizeRaw } from "../../../core/pipeline/normalize-step.ts";
import type { RawExtraction } from "../../../core/pipeline/prompts/extract.ts";
import { decide, toDecisionCall, type ReviewState } from "../../../core/review/actions.ts";

const classification: Classification = {
  gp_name: "Harbourline Partners", fund_name: "Harbourline Growth II", period_end: "2025-09-30", report_type: "quarterly_report",
  currency: "USD", unit_statement: "USD m", evidence_page: 1, gp_status: "known", known_fund_id: "f-har", missing: [],
};
const v = (raw: string | null, page: number | null = 1) => ({ raw, page });
// Consistent except where a test breaks it: TVPI (60+420.8)/330.5 = 1.45.
function raw(fund: Partial<RawExtraction["fund"]> = {}): RawExtraction {
  return {
    readMode: "text", visionFields: [],
    fund: { commitment: v("500.0"), paid_in: v("330.5"), unfunded: v("169.5"), distributions: v("60.0"), nav: v("420.8"),
      tvpi: v("1.45x"), dpi: v("0.18x"), rvpi: v("1.27x"), net_irr: v("7.1%"), ...fund },
    portfolio: { companies: [{ name: "A Inc.", country: "US", sector: "Software", investment_date: null,
      invested: v("200.0", 2), realized: v("0.0", 2), unrealized: v("420.8", 2), total_value: v("420.8", 2), gross_moic: v("2.10x", 2) }] },
    operating: { companies: [{ name: "A Inc.", revenue_ltm: v("300.0", 3), ebitda_ltm: v("724", 3), net_debt: v("10.0", 3) }] },
    qualitative: { key_updates: [], outlook: null },
  };
}
const FUNDS: KnownFund[] = [{ id: "f-har", gp_name: "Harbourline Partners", fund_name: "Harbourline Growth II", aliases: [] }];

function state(over: Partial<ReviewState> = {}): ReviewState {
  const r = over.raw ?? raw();
  const c = over.classification ?? classification;
  const { checks } = normalizeRaw(r, c);
  return { status: "needs_review", raw: r, classification: c, checks, pageCount: 3, policy: "policy@2",
    pendingKeyFigures: [], knownFunds: FUNDS, ...over };
}
const analyst = "Gabriele";

describe("decide: the transition table", () => {
  it.each([
    ["needs_review", { kind: "approve", reason: "checked" }, "approved"],
    ["needs_review", { kind: "reject", reason: "ask the GP for a corrected report" }, "rejected"],
    ["needs_review", { kind: "accept_field", field: "fund.nav" }, "needs_review"],
    ["needs_triage", { kind: "assign_fund", fundId: "f-har" }, "needs_review"],
    ["needs_triage", { kind: "reject", reason: "not one of our funds" }, "rejected"],
  ] as const)("%s + %j -> %s", (status, action, next) => {
    const result = decide(state({ status }), action, analyst);
    expect(result).toMatchObject({ ok: true, value: { nextStatus: next } });
  });

  it.each([
    ["ready_to_post", { kind: "approve", reason: "x" }],
    ["approved", { kind: "approve", reason: "again" }],
    ["rejected", { kind: "approve", reason: "x" }],
    ["needs_triage", { kind: "approve", reason: "x" }],
    ["needs_review", { kind: "assign_fund", fundId: "f-har" }],
    ["running", { kind: "reject", reason: "x" }],
  ] as const)("refuses %s + %j", (status, action) => {
    expect(decide(state({ status }), action, analyst)).toMatchObject({ ok: false, error: { code: "forbidden_transition" } });
  });
});

describe("decide: reasons and readiness", () => {
  it("always needs a reason to reject", () => {
    expect(decide(state(), { kind: "reject", reason: "  " }, analyst)).toMatchObject({ ok: false, error: { code: "reason_required" } });
  });

  it("needs a reason to approve exactly when a check still fails (trap 1: the report itself is inconsistent)", () => {
    const inconsistent = state({ raw: raw({ tvpi: v("1.57x") }) });

    expect(decide(inconsistent, { kind: "approve" }, analyst)).toMatchObject({ ok: false, error: { code: "reason_required", message: expect.stringMatching(/tvpi/i) } });
    expect(decide(inconsistent, { kind: "approve", reason: "Posted as printed; GP asked to restate TVPI." }, analyst))
      .toMatchObject({ ok: true, value: { nextStatus: "approved", decision: { kind: "approved", reason: "Posted as printed; GP asked to restate TVPI." } } });
    const clean = state({ raw: { ...raw(), operating: { companies: [] } } });
    expect(decide(clean, { kind: "approve" }, analyst)).toMatchObject({ ok: true });
  });

  it("refuses approval while a non-high key figure has not been accepted or corrected", () => {
    const result = decide(state({ pendingKeyFigures: [{ path: "fund.nav", label: "Net asset value" }] }), { kind: "approve", reason: "x" }, analyst);

    expect(result).toMatchObject({ ok: false, error: { code: "review_incomplete", message: expect.stringMatching(/Net asset value/) } });
  });

  it("records who decided, and refuses an anonymous decision", () => {
    expect(decide(state(), { kind: "accept_field", field: "fund.nav" }, "  ")).toMatchObject({ ok: false, error: { code: "analyst_required" } });
    expect(decide(state(), { kind: "accept_field", field: "fund.nav" }, "Gabriele"))
      .toMatchObject({ ok: true, value: { decision: { kind: "field_accepted", field: "fund.nav", analyst: "Gabriele", policy: "policy@2" } } });
  });
});

describe("decide: corrections", () => {
  it("re-runs the pipeline's normalization and checks: an OCR-lost decimal fixed clears the EBITDA check", () => {
    const before = state();
    expect(before.checks.find((c) => c.id === "company_ebitda_exceeds_revenue")?.status).toBe("fail");

    const result = decide(before, { kind: "correct", field: "portfolio_companies[0].ebitda_ltm", raw: "72.4", page: 3 }, analyst);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.correction?.extraction?.portfolio_companies[0]?.ebitda_ltm?.value).toBe(72_400_000);
    expect(result.value.correction?.checks.find((c) => c.id === "company_ebitda_exceeds_revenue")?.status).toBe("pass");
    expect(result.value.decision).toMatchObject({
      kind: "field_corrected", field: "portfolio_companies[0].ebitda_ltm",
      before: { raw: "724", page: 3, value: 724_000_000 }, after: { raw: "72.4", page: 3, value: 72_400_000 },
    });
    expect(before.raw.operating.companies[0]?.ebitda_ltm.raw).toBe("724"); // the stored round is never edited
  });

  it.each([
    [{ field: "fund.nav", raw: "four hundred", page: 1 }, "unreadable_value"],
    [{ field: "fund.nav", raw: "420.8", page: 9 }, "invalid_page"],
    [{ field: "fund.nav", raw: "420.8", page: 0 }, "invalid_page"],
    [{ field: "fund.made_up", raw: "1", page: 1 }, "unknown_field"],
  ] as const)("refuses %j (%s)", (fix, code) => {
    expect(decide(state(), { kind: "correct", ...fix }, analyst)).toMatchObject({ ok: false, error: { code } });
  });
});

describe("decide: triage", () => {
  it("assigns an unknown GP's report to a registry fund, and refuses a fund outside the registry", () => {
    const unknown = state({ status: "needs_triage", classification: { ...classification, gp_status: "unknown", known_fund_id: null, fund_name: "Harbourline Growth ||" } });

    expect(decide(unknown, { kind: "assign_fund", fundId: "f-har" }, analyst)).toMatchObject({ ok: true, value: {
      nextStatus: "needs_review", classification: { gp_status: "known", known_fund_id: "f-har", fund_name: "Harbourline Growth II", gp_name: "Harbourline Partners" },
      decision: { kind: "fund_assigned", before: { raw: "Harbourline Growth ||" }, after: { raw: "Harbourline Growth II" } },
    } });
    expect(decide(unknown, { kind: "assign_fund", fundId: "f-new" }, analyst)).toMatchObject({ ok: false, error: { code: "unknown_fund" } });
    const assigned = decide(unknown, { kind: "assign_fund", fundId: "f-har" }, analyst);
    expect(assigned.ok && assigned.value.correction?.extraction?.classification.fund_name).toBe("Harbourline Growth II");
  });
});

describe("toDecisionCall", () => {
  it("passes the status the analyst saw, so a stale screen cannot act, and the new round only when there is one", () => {
    const corrected = decide(state(), { kind: "correct", field: "portfolio_companies[0].ebitda_ltm", raw: "72.4", page: 3 }, analyst);
    const accepted = decide(state(), { kind: "accept_field", field: "fund.nav" }, analyst);
    if (!corrected.ok || !accepted.ok) throw new Error("fixture");

    expect(toDecisionCall("run-1", "needs_review", corrected.value)).toMatchObject({
      p_run: "run-1", p_expected: "needs_review", p_next: "needs_review", p_decision: { kind: "field_corrected" },
      p_extraction: { extraction: { portfolio_companies: [{ ebitda_ltm: { value: 72_400_000 } }] } },
    });
    expect(toDecisionCall("run-1", "needs_review", accepted.value).p_extraction).toBeNull();
  });
});
