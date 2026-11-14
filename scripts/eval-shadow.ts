// npm run eval:shadow -- --step <classify|extract|critic|confidence> --model <model> [--cap 2]
// One step on a candidate model, every other step unchanged, scored on the golden set's dev split next to the replayed
// baseline (SPEC-evals "Shadow"). Live calls are budget-guarded and capped per experiment, and recorded under the
// candidate's own cache keys, so the experiment replays later for free.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dailyBudgetUsd, withBudget } from "../core/budget.ts";
import { compareShadow } from "../core/evals/shadow.ts";
import { withSpendCap, withStepModel, type LlmClient } from "../core/llm.ts";
import { anthropicFromEnv } from "../netlify/lib/anthropic-llm.ts";
import { createReplayLlm, createReplayOrRecordLlm } from "../netlify/lib/replay-llm.ts";
import { createAdminClient } from "../netlify/lib/supabase.ts";
import { createSupabaseUsageLedger } from "../netlify/lib/usage-ledger.ts";
import { FIXTURES, ROOT } from "../tests/support/dev-corpus.ts";
import { evaluateDev } from "./eval-lib.ts";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const step = arg("step");
const model = arg("model");
const cap = Number(arg("cap") ?? 2);
if (!step || !["classify", "extract", "critic", "confidence"].includes(step) || !model) {
  throw new Error("usage: npm run eval:shadow -- --step <classify|extract|critic|confidence> --model <model> [--cap 2]");
}
process.loadEnvFile(path.join(ROOT, ".env"));
const db = createAdminClient(process.env);
if (!db) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");

// Live calls: timed, capped for this experiment, and counted against the daily budget.
const seconds: number[] = [];
const capped = withSpendCap(withBudget(anthropicFromEnv(process.env.ANTHROPIC_API_KEY), createSupabaseUsageLedger(db),
  { budgetUsd: dailyBudgetUsd(process.env.DAILY_LLM_BUDGET_USD), runId: `local-shadow-${step}` }), cap);
const timed: LlmClient = { async complete(request) {
  const t = performance.now();
  try { return await capped.complete(request); } finally { if (request.step === step) seconds.push((performance.now() - t) / 1000); }
} };

const baseline = await evaluateDev(createReplayLlm(FIXTURES));
const candidate = await evaluateDev(withStepModel(createReplayOrRecordLlm(timed, FIXTURES), step, model));
const comparison = compareShadow({ step, model, baseline: baseline.summary, candidate: candidate.summary,
  baselineCostUsd: baseline.costByStep[step] ?? 0, candidateCostUsd: candidate.costByStep[step] ?? 0 });
const verdict = candidate.unevaluated.length > 0
  ? { ...comparison, verdict: "keep" as const, reason: `Incomplete: ${candidate.unevaluated.length} document(s) not evaluated (${candidate.unevaluated[0]}).` }
  : comparison;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rows: [string, string, string][] = [
  ["Unsafe auto-posts", String(baseline.summary.unsafe), String(candidate.summary.unsafe)],
  ["Key-figure accuracy", pct(baseline.summary.keyFigureAccuracy), pct(candidate.summary.keyFigureAccuracy)],
  ["All-figure accuracy", pct(baseline.summary.allFigureAccuracy), pct(candidate.summary.allFigureAccuracy)],
  ["Classification accuracy", pct(baseline.summary.classificationAccuracy), pct(candidate.summary.classificationAccuracy)],
  ["Route accuracy", pct(baseline.summary.routeAccuracy), pct(candidate.summary.routeAccuracy)],
  [`Cost of step "${step}" (12 documents)`, `$${(baseline.costByStep[step] ?? 0).toFixed(3)}`, `$${(candidate.costByStep[step] ?? 0).toFixed(3)}`],
  ["Cost of the whole pass", `$${Object.values(baseline.costByStep).reduce((a, b) => a + b, 0).toFixed(3)}`,
    `$${Object.values(candidate.costByStep).reduce((a, b) => a + b, 0).toFixed(3)}`],
];
const md = [`# Shadow run · ${step} on ${model} · ${new Date().toISOString().slice(0, 10)}`, "",
  `**Verdict: ${verdict.verdict}.** ${verdict.reason}`, "",
  "| Metric | Baseline (claude-opus-5-5) | Candidate |", "|---|---|---|", ...rows.map((r) => `| ${r.join(" | ")} |`), "",
  `Live candidate calls: ${seconds.length} (median ${seconds.length ? seconds.sort((a, b) => a - b)[Math.floor(seconds.length / 2)]?.toFixed(1) : "–"} s); ` +
  `new spend for this experiment: $${capped.spentUsd().toFixed(3)} (cap $${cap.toFixed(2)}).`, "",
  "Candidate errors:", ...candidate.reports.flatMap((r) => r.errors.map((e) => `- ${r.doc_id} · ${e.label} · step ${e.step}`)), ""].join("\n");
await mkdir(path.join(ROOT, "evals/shadow"), { recursive: true });
const name = `${new Date().toISOString().slice(0, 10)}-${step}-${model}`;
await writeFile(path.join(ROOT, "evals/shadow", `${name}.json`), JSON.stringify({ ...verdict, costByStep: { baseline: baseline.costByStep, candidate: candidate.costByStep },
  liveSeconds: seconds, spentUsd: capped.spentUsd(), errors: candidate.reports.flatMap((r) => r.errors.map((e) => ({ doc: r.doc_id, ...e }))) }, null, 2) + "\n");
await writeFile(path.join(ROOT, "evals/shadow", `${name}.md`), md);
console.log(md);
