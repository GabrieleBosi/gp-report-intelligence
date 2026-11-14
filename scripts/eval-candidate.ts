// npm run eval:candidate -- --steps classify,extract,confidence --model <model> --split heldout [--cap 2]
// A whole configuration (several steps on a candidate model) measured live on a split, without changing production.
// For held-out: measurement only; nothing is recorded as a fixture and nothing is tuned on it (SPEC-evals).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dailyBudgetUsd, withBudget } from "../core/budget.ts";
import { checkGate } from "../core/evals/gate.ts";
import { renderMarkdown } from "../core/evals/report.ts";
import { withSpendCap, withStepModel, type LlmClient } from "../core/llm.ts";
import { PIPELINE_VERSION } from "../core/pipeline/version.ts";
import { anthropicFromEnv } from "../netlify/lib/anthropic-llm.ts";
import { createAdminClient } from "../netlify/lib/supabase.ts";
import { createSupabaseUsageLedger } from "../netlify/lib/usage-ledger.ts";
import { ROOT } from "../tests/support/dev-corpus.ts";
import { evaluateDev } from "./eval-lib.ts";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const steps = (arg("steps") ?? "").split(",").filter(Boolean);
const model = arg("model");
const split = (arg("split") ?? "heldout") as "dev" | "heldout";
const cap = Number(arg("cap") ?? 2);
if (steps.length === 0 || !model) throw new Error("usage: npm run eval:candidate -- --steps a,b --model <model> --split heldout [--cap 2]");
process.loadEnvFile(path.join(ROOT, ".env"));
const db = createAdminClient(process.env);
if (!db) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");

const capped = withSpendCap(withBudget(anthropicFromEnv(process.env.ANTHROPIC_API_KEY), createSupabaseUsageLedger(db),
  { budgetUsd: dailyBudgetUsd(process.env.DAILY_LLM_BUDGET_USD), runId: `local-candidate-${split}` }), cap);
let llm: LlmClient = capped;
for (const step of steps) llm = withStepModel(llm, step, model);

const result = await evaluateDev(llm, split);
const gate = checkGate(result.summary, { ...result.summary, unsafe: 0 }); // held-out has no baseline: only the unsafe rule applies
const md = renderMarkdown({ version: `${PIPELINE_VERSION} with ${steps.join(", ")} on ${model} (${split})`,
  generated_at: new Date().toISOString().slice(0, 10), reports: result.reports, summary: result.summary, gate });
const name = `${new Date().toISOString().slice(0, 10)}-${split}-${steps.join("+")}-${model}`;
await mkdir(path.join(ROOT, "evals/candidates"), { recursive: true });
await writeFile(path.join(ROOT, "evals/candidates", `${name}.md`), md +
  `\nLive spend: $${capped.spentUsd().toFixed(3)} (cap $${cap.toFixed(2)}). Not evaluated: ${result.unevaluated.length ? result.unevaluated.join("; ") : "none"}.\n`);
console.log(md.split("## Documents")[0]);
console.log(`routes: ${result.reports.map((r) => `${r.doc_id}=${r.route}${r.routeOk ? "" : ` (expected ${r.expected_route})`}${r.unsafe ? " UNSAFE" : ""}`).join(", ")}`);
console.log(`live spend $${capped.spentUsd().toFixed(3)} · report evals/candidates/${name}.md`);
