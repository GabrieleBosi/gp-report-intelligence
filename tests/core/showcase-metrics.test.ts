import { describe, expect, it } from "vitest";
import { computeMetrics, METRIC_COLUMNS, Metrics, type MetricRows } from "../../core/showcase/metrics.ts";

const rows = (over: Partial<MetricRows> = {}): MetricRows => ({
  documents: [{ source: "corpus" }, { source: "corpus" }, { source: "upload" }],
  pipeline_runs: [{ id: "r1", status: "posted" }, { id: "r2", status: "needs_review" }, { id: "r3", status: "failed" }, { id: "r4", status: "posted" }],
  assessments: [
    { run_id: "r1", round: 0, route: "auto_post" },
    { run_id: "r2", round: 0, route: "auto_post" }, { run_id: "r2", round: 1, route: "review" }, // the latest round counts
    { run_id: "r4", round: 0, route: "review" },
  ],
  review_decisions: [{ kind: "field_accepted" }, { kind: "field_accepted" }, { kind: "approved" }],
  postings: [{ outcome: "posted" }, { outcome: "failed" }, { outcome: "posted" }, { outcome: "unchanged" }],
  portfolio_records: [{ version: 1 }, { version: 2 }, { version: 1 }],
  usage_ledger: [{ cost_usd: "0.0125", step: "extract" }, { cost_usd: 0.02, step: "extract" }, { cost_usd: "0.005", step: "classify" }],
  ...over,
});

describe("computeMetrics", () => {
  it("counts what happened on the site: documents, runs, routes, decisions, postings, records, spend", () => {
    const m = computeMetrics(rows(), new Date("2026-10-11T18:00:00Z"));
    expect(m).toEqual({
      generated_at: "2026-10-11T18:00:00.000Z",
      documents: { total: 3, corpus: 2, upload: 1 },
      runs: { total: 4, byStatus: { posted: 2, needs_review: 1, failed: 1 } },
      routes: { auto_post: 1, review: 2, triage: 0 },
      review: { decisions: 3, byKind: { field_accepted: 2, approved: 1 } },
      postings: { attempts: 4, byOutcome: { posted: 2, failed: 1, unchanged: 1 } },
      portfolio: { records: 2, versions: 3 },
      llm: { calls: 3, costUsd: 0.0375, byStep: { extract: 0.0325, classify: 0.005 } },
    });
    expect(Metrics.parse(m)).toEqual(m);
  });

  it("works on an empty site", () => {
    const empty = computeMetrics({ documents: [], pipeline_runs: [], assessments: [], review_decisions: [], postings: [],
      portfolio_records: [], usage_ledger: [] }, new Date(0));
    expect(empty.routes).toEqual({ auto_post: 0, review: 0, triage: 0 });
    expect(empty.llm).toEqual({ calls: 0, costUsd: 0, byStep: {} });
  });

  it("reads aggregates only: no file names, labels, figures, analysts' names or reasons ever leave the database", () => {
    const columns = Object.values(METRIC_COLUMNS).join(",").split(",").map((c) => c.trim());
    for (const forbidden of ["filename", "corpus_meta", "storage_path", "sha256", "payload", "fields", "reasons", "reason",
      "analyst", "before", "after", "error", "raw", "extraction", "*"]) {
      expect(columns, forbidden).not.toContain(forbidden);
    }
  });
});
