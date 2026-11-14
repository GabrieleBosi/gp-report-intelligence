// Live operating numbers for the showcase (SPEC-showcase, page 5): counts only. The columns read are listed here, and a
// test checks that none of them carries document content, labels, figures or analysts' words.
import { z } from "zod";

export const METRIC_COLUMNS = {
  documents: "source",
  pipeline_runs: "id, status",
  assessments: "run_id, round, route",
  review_decisions: "kind",
  postings: "outcome",
  portfolio_records: "version",
  usage_ledger: "cost_usd, step",
} as const;

export type MetricRows = {
  documents: { source: string }[];
  pipeline_runs: { id: string; status: string }[];
  assessments: { run_id: string; round: number; route: string }[];
  review_decisions: { kind: string }[];
  postings: { outcome: string }[];
  portfolio_records: { version: number }[];
  usage_ledger: { cost_usd: number | string; step: string | null }[];
};

const Counts = z.record(z.string(), z.number());
export const Metrics = z.object({
  generated_at: z.string(),
  documents: z.object({ total: z.number(), corpus: z.number(), upload: z.number() }),
  runs: z.object({ total: z.number(), byStatus: Counts }),
  routes: z.object({ auto_post: z.number(), review: z.number(), triage: z.number() }),
  review: z.object({ decisions: z.number(), byKind: Counts }),
  postings: z.object({ attempts: z.number(), byOutcome: Counts }),
  portfolio: z.object({ records: z.number(), versions: z.number() }),
  llm: z.object({ calls: z.number(), costUsd: z.number(), byStep: Counts }),
});
export type Metrics = z.infer<typeof Metrics>;

const countBy = <T>(items: T[], key: (t: T) => string) =>
  items.reduce<Record<string, number>>((acc, t) => { acc[key(t)] = (acc[key(t)] ?? 0) + 1; return acc; }, {});
const cents4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function computeMetrics(rows: MetricRows, now: Date): Metrics {
  // A run's route is the one of its latest assessment round (the critic and analyst corrections add rounds).
  const latest = new Map<string, { round: number; route: string }>();
  for (const a of rows.assessments) {
    const seen = latest.get(a.run_id);
    if (!seen || a.round >= seen.round) latest.set(a.run_id, a);
  }
  const routes = countBy([...latest.values()], (a) => a.route);
  const byStep: Record<string, number> = {};
  for (const u of rows.usage_ledger) byStep[u.step ?? "other"] = cents4((byStep[u.step ?? "other"] ?? 0) + Number(u.cost_usd));

  return {
    generated_at: now.toISOString(),
    documents: { total: rows.documents.length, corpus: rows.documents.filter((d) => d.source === "corpus").length,
      upload: rows.documents.filter((d) => d.source === "upload").length },
    runs: { total: rows.pipeline_runs.length, byStatus: countBy(rows.pipeline_runs, (r) => r.status) },
    routes: { auto_post: routes.auto_post ?? 0, review: routes.review ?? 0, triage: routes.triage ?? 0 },
    review: { decisions: rows.review_decisions.length, byKind: countBy(rows.review_decisions, (d) => d.kind) },
    postings: { attempts: rows.postings.length, byOutcome: countBy(rows.postings, (p) => p.outcome) },
    portfolio: { records: rows.portfolio_records.filter((r) => r.version === 1).length, versions: rows.portfolio_records.length },
    llm: { calls: rows.usage_ledger.length, costUsd: cents4(rows.usage_ledger.reduce((s, u) => s + Number(u.cost_usd), 0)), byStep },
  };
}
