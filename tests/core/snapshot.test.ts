import { describe, expect, it } from "vitest";
import { groupRecords, type PortfolioRow } from "../../core/posting/portfolio-view.ts";
import { applyReviewDecision, completePosting, corpusOnly, corpusPortfolio, portfolioPost, uuidsIn, type ExportRows, type LocalRun } from "../../core/snapshot.ts";

// SPEC-public-release W2: what the public snapshot contains is decided by these two rules.
const A = "7bc2ccb5-5b9b-4315-9fa6-a7cc85df4bd9";
const B = "0c3dac74-82ec-440a-8c8c-743a45b7e8ca";

describe("uuidsIn: the run ids a response links to", () => {
  it("finds ids at any depth, in strings and in links, once each", () => {
    const view = { run: { id: A }, steps: [{ details: { supersedes: B } }], note: `see /runs/${A}`, list: [B, "not-an-id"] };
    expect(uuidsIn(view).sort()).toEqual([A, B].sort());
  });

  it("ignores numbers, nulls and look-alikes", () => {
    expect(uuidsIn({ a: 1, b: null, c: "7bc2ccb5-5b9b-4315-9fa6", d: true })).toEqual([]);
  });
});

describe("corpusOnly: the metrics leave out uploaded documents and everything that hangs off them", () => {
  const rows: ExportRows = {
    documents: [{ id: "d-corpus", source: "corpus" }, { id: "d-upload", source: "upload" }],
    pipeline_runs: [{ id: "r1", status: "posted", document_id: "d-corpus" }, { id: "r2", status: "needs_review", document_id: "d-upload" }],
    assessments: [{ run_id: "r1", round: 0, route: "auto_post" }, { run_id: "r2", round: 0, route: "review" }],
    review_decisions: [{ kind: "accept", run_id: "r1" }, { kind: "fix", run_id: "r2" }],
    postings: [{ outcome: "posted", run_id: "r1" }, { outcome: "posted", run_id: "r2" }],
    portfolio_records: [{ version: 1, source_run: "r1" }, { version: 1, source_run: "r2" }],
    usage_ledger: [{ cost_usd: 0.5, step: "extract", run_id: "r1" }, { cost_usd: 0.25, step: "extract", run_id: "r2" },
      { cost_usd: 1, step: "shadow", run_id: null }],
  };

  it("keeps corpus documents, their runs and every row of those runs", () => {
    const kept = corpusOnly(rows);
    expect(kept.documents).toEqual([{ id: "d-corpus", source: "corpus" }]);
    expect(kept.pipeline_runs.map((r) => r.id)).toEqual(["r1"]);
    expect(kept.assessments.map((r) => r.run_id)).toEqual(["r1"]);
    expect(kept.review_decisions.map((r) => r.run_id)).toEqual(["r1"]);
    expect(kept.postings.map((r) => r.run_id)).toEqual(["r1"]);
    expect(kept.portfolio_records.map((r) => r.source_run)).toEqual(["r1"]);
  });

  it("keeps model spend that belongs to no run (evals, experiments): it was spent on the corpus", () => {
    expect(corpusOnly(rows).usage_ledger.map((r) => r.cost_usd)).toEqual([0.5, 1]);
  });
});

describe("corpusPortfolio: the portfolio leaves out records posted from uploaded documents", () => {
  const row = (version: number, source_run: string, posted_at: string): PortfolioRow => ({
    fund_id: "f-1", fund_name: "Alpenrose Buyout IV", gp_name: "Alpenrose Capital", period_end: "2025-09-30", version, posted_at,
    source_run, currency: "EUR", nav: 1, tvpi: 1, dpi: 0, cleared: { by: "auto_post", policy: "policy@3" },
  });
  const groups = groupRecords([row(1, "r-corpus-1", "2026-10-11T10:00:00Z"), row(2, "r-upload", "2026-10-12T10:00:00Z"),
    { ...row(1, "r-upload-only", "2026-10-13T10:00:00Z"), fund_id: "f-2", fund_name: "Meridian Tech Opportunities I" }]);

  it("keeps only versions whose run is a corpus run, and the newest kept version becomes current again", () => {
    const kept = corpusPortfolio(groups, new Set(["r-corpus-1"]));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.current).toMatchObject({ version: 1, source_run: "r-corpus-1", superseded: false });
    expect(kept[0]?.history.map((r) => r.source_run)).toEqual(["r-corpus-1"]);
  });

  it("leaves no id of an upload's run behind, so the export never follows one", () => {
    expect(JSON.stringify(corpusPortfolio(groups, new Set(["r-corpus-1"])))).not.toMatch(/r-upload/);
  });
});

// The review in the browser (ADR-0006) runs the server's own TypeScript (handleReview, decide, postRun) against
// in-memory stores. These mirror the three SQL functions that the server calls instead, rule for rule.
describe("applyReviewDecision mirrors apply_review_decision", () => {
  const decision = { kind: "field_accepted" as const, field: "fund.nav", before: null, after: null, reason: null, analyst: "Visitor", policy: "policy@3" };
  const run = (status: string, round = 2): LocalRun => ({
    run: { id: "r1", status, pipeline_version: "pipeline@0.13.0" }, documentSha256: "abc", classify: {}, pageCount: 3,
    latest: { round, raw: { fund: "raw" }, extraction: null, checks: [] } as unknown as LocalRun["latest"],
    assessment: null, decisions: [], knownFunds: [], postings: [],
  });
  const at = "2026-11-14T12:00:00.000Z";

  it("refuses a decision made on a view that is no longer current", () => {
    expect(applyReviewDecision(run("approved"), "needs_review", { nextStatus: "approved", decision }, at)).toMatchObject({ ok: false });
  });

  it("appends the decision and moves the run to its next status", () => {
    const result = applyReviewDecision(run("needs_review"), "needs_review", { nextStatus: "approved", decision }, at);
    expect(result).toMatchObject({ ok: true, value: { run: { status: "approved" }, decisions: [{ ...decision, created_at: at }] } });
  });

  it("stores a correction as a new analyst round, never below round 3 (after the critic's rounds)", () => {
    const correction = { raw: { fund: "fixed" }, extraction: null, checks: [] } as never;
    const first = applyReviewDecision(run("needs_review", 0), "needs_review", { nextStatus: "needs_review", decision, correction }, at);
    expect(first.ok && first.value.latest).toMatchObject({ round: 3, raw: { fund: "fixed" } });
    const later = applyReviewDecision(run("needs_review", 4), "needs_review", { nextStatus: "needs_review", decision, correction }, at);
    expect(later.ok && later.value.latest.round).toBe(5);
  });

  it("does not change the run it was given", () => {
    const before = run("needs_review");
    applyReviewDecision(before, "needs_review", { nextStatus: "approved", decision }, at);
    expect(before.run.status).toBe("needs_review");
    expect(before.decisions).toEqual([]);
  });
});

describe("portfolioPost mirrors portfolio_post", () => {
  const record = (hash: string) => ({ fund_id: "f-1", period_end: "2026-03-31", figures_hash: hash } as never);
  const funds = new Set(["f-1"]);
  const existing = [{ fund_id: "f-1", period_end: "2026-03-31", version: 1, source_run: "r0", figures_hash: "h1" }];

  it("posts a new version over the current one, which it supersedes", () => {
    const { result, records } = portfolioPost(existing, funds, "r1", record("h2"));
    expect(result).toEqual({ kind: "posted", recordId: "f-1:2026-03-31", version: 2, supersedes: 1 });
    expect(records).toHaveLength(2);
  });

  it("answers unchanged when the figures equal the current version's", () => {
    expect(portfolioPost(existing, funds, "r1", record("h1")).result).toEqual({ kind: "unchanged", recordId: "f-1:2026-03-31", version: 1, supersedes: null });
  });

  it("answers duplicate for a run that already posted", () => {
    expect(portfolioPost(existing, funds, "r0", record("h9")).result).toMatchObject({ kind: "duplicate", version: 1 });
  });

  it("refuses a fund that is not in the registry, as a final rejection", () => {
    expect(() => portfolioPost(existing, new Set(), "r1", record("h2"))).toThrow(expect.objectContaining({ kind: "rejected" }));
  });
});

describe("completePosting mirrors complete_posting", () => {
  const attempt = { outcome: "posted" as const, record_id: "f-1:2026-03-31", version: 2, error: null, figures_hash: "h2" };
  const at = "2026-11-14T12:00:00.000Z";
  const base = { run: { id: "r1", status: "approved", pipeline_version: "p" }, postings: [] } as unknown as LocalRun;

  it("numbers the attempts and marks the run posted when asked", () => {
    const once = completePosting(base, attempt, true, at);
    expect(once.run.status).toBe("posted");
    expect(once.postings).toEqual([{ attempt: 1, outcome: "posted", record_id: "f-1:2026-03-31", version: 2, error: null, created_at: at }]);
    expect(completePosting(once, { ...attempt, outcome: "failed" }, false, at).postings.map((p) => p.attempt)).toEqual([1, 2]);
  });

  it("leaves the status alone when the attempt did not post", () => {
    expect(completePosting(base, { ...attempt, outcome: "failed" }, false, at).run.status).toBe("approved");
  });
});
