import { describe, expect, it } from "vitest";
import type { AssessmentView, DecisionView } from "../../core/pipeline/run-view.ts";
import { approvalBlockers, checkRows, pageOf, reviewChecklist } from "../../src/lib/review.ts";

const field = (path: string, label: string, level: "high" | "medium" | "low") => ({
  path, label, valueA: 1, rawA: "1", valueB: 1, rawB: "1", checks: "pass" as const, reads: "agree" as const, flags: [], level, reason: `${label} reason`,
});
const assessment: AssessmentView = { round: 0, route: "review", level: "low", policy: "policy@2", reasons: [], fields: [
  field("fund.commitment", "Total commitments", "high"), field("fund.nav", "Net asset value", "medium"), field("fund.tvpi", "TVPI", "low"),
] };
const decision = (kind: DecisionView["kind"], fieldPath: string | null): DecisionView => ({
  kind, field: fieldPath, before: null, after: null, reason: null, analyst: "G", policy: "policy@2", created_at: "2026-10-11T12:00:00Z",
});

describe("reviewChecklist", () => {
  it("puts the figures that need attention first (low, then medium, then high) and marks what was decided", () => {
    const rows = reviewChecklist(assessment, [decision("field_accepted", "fund.nav")]);

    expect(rows.map((r) => [r.label, r.state])).toEqual([["TVPI", "pending"], ["Net asset value", "accepted"], ["Total commitments", "ok"]]);
  });

  it("shows the latest decision for a figure (corrected after an earlier accept)", () => {
    const rows = reviewChecklist(assessment, [decision("field_accepted", "fund.tvpi"), decision("field_corrected", "fund.tvpi")]);

    expect(rows[0]).toMatchObject({ label: "TVPI", state: "corrected" });
  });
});

describe("approvalBlockers", () => {
  it("lists the figures still pending and whether a reason is needed because a check fails", () => {
    expect(approvalBlockers(reviewChecklist(assessment, []), ["tvpi_inconsistent"])).toEqual({ pending: ["TVPI", "Net asset value"], reasonRequired: true });
    expect(approvalBlockers(reviewChecklist(assessment, [decision("field_accepted", "fund.tvpi"), decision("field_accepted", "fund.nav")]), []))
      .toEqual({ pending: [], reasonRequired: false });
  });
});

describe("pageOf", () => {
  const raw = { fund: { nav: { raw: "420.8", page: 1 } }, portfolio: { companies: [{ name: "A", total_value: { raw: "1", page: 2 } }] },
    operating: { companies: [{ name: "A", ebitda_ltm: { raw: "7", page: 3 } }] } };

  it("finds the page a figure was read from, so the source view can jump to it", () => {
    expect(pageOf(raw, "fund.nav")).toBe(1);
    expect(pageOf(raw, "portfolio_companies[0].total_value")).toBe(2);
    expect(pageOf(raw, "portfolio_companies[0].ebitda_ltm")).toBe(3);
    expect(pageOf(raw, "fund.unknown")).toBeNull();
  });
});

describe("checkRows", () => {
  const checks = [
    { id: "company_ebitda_exceeds_revenue", status: "fail" as const, message: "company EBITDA exceeds its revenue", fields: [],
      failing: ["portfolio_companies[0].ebitda_ltm", "portfolio_companies[0].revenue_ltm"] },
    { id: "tvpi_inconsistent", status: "fail" as const, message: "TVPI does not match", fields: ["fund.tvpi", "fund.nav"] },
    { id: "dpi_inconsistent", status: "pass" as const, message: "ok", fields: ["fund.dpi"] },
  ];
  const companies = [{ name: "Luori Inc." }];

  it("lists the figures named by failed checks that are not key figures, so the analyst can correct them too", () => {
    expect(checkRows(checks, assessment, companies, [])).toEqual([
      { path: "portfolio_companies[0].ebitda_ltm", label: "Luori Inc.: EBITDA LTM", reason: "company EBITDA exceeds its revenue", corrected: false },
      { path: "portfolio_companies[0].revenue_ltm", label: "Luori Inc.: revenue LTM", reason: "company EBITDA exceeds its revenue", corrected: false },
    ]);
  });

  it("marks a corrected one", () => {
    expect(checkRows(checks, assessment, companies, [decision("field_corrected", "portfolio_companies[0].ebitda_ltm")])[0]?.corrected).toBe(true);
  });
});
