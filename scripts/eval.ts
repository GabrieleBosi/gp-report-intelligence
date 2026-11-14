// npm run eval - the golden set's dev split through steps 2-7 by replay (recorded answers: $0), scored against the
// labels, every error attributed to its first bad step, compared with evals/baseline.json (SPEC-evals). Exits 1 when
// the gate fails or a document cannot be evaluated. --update-baseline writes the new baseline (a reviewed change).
// --heldout replays the held-out split instead and only prints its scores: it is measured, never gated or tuned on.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkGate } from "../core/evals/gate.ts";
import { renderMarkdown } from "../core/evals/report.ts";
import { PIPELINE_VERSION } from "../core/pipeline/version.ts";
import { createReplayLlm } from "../netlify/lib/replay-llm.ts";
import { FIXTURES, ROOT } from "../tests/support/dev-corpus.ts";
import { evaluateDev } from "./eval-lib.ts";

const updateBaseline = process.argv.includes("--update-baseline");
const heldout = process.argv.includes("--heldout");
const started = performance.now();
const { reports, summary, unevaluated } = await evaluateDev(createReplayLlm(FIXTURES), heldout ? "heldout" : "dev");
if (unevaluated.length > 0) {
  console.error(`Could not evaluate ${unevaluated.length} document(s); the change asks the model new questions. ` +
    `Re-record the fixtures (node scripts/record-fixtures.ts <step> [formats]) and run the eval again:\n  ${unevaluated.join("\n  ")}`);
  process.exit(1);
}
const generated_at = new Date().toISOString().slice(0, 10);
if (heldout) {
  const md = renderMarkdown({ version: PIPELINE_VERSION, generated_at, reports, summary, gate: { pass: true, failures: [] } });
  console.log(`Held-out split, replayed (recorded answers, $0). Not gated: compare it with the dev split.\n`);
  console.log(md.split("## Documents")[0].replace(/\nGate: \*\*pass\*\*\n/, ""));
  process.exit(0);
}
const baselinePath = path.join(ROOT, "evals/baseline.json");
const baseline = updateBaseline ? summary : JSON.parse(await readFile(baselinePath, "utf8").catch(() => JSON.stringify(summary)));
const gate = checkGate(summary, baseline);
const name = `${generated_at}-${PIPELINE_VERSION.replace("@", "-")}`;
await mkdir(path.join(ROOT, "evals/reports"), { recursive: true });
await writeFile(path.join(ROOT, "evals/reports", `${name}.json`), JSON.stringify({ version: PIPELINE_VERSION, generated_at, summary, gate, reports }, null, 2) + "\n");
const md = renderMarkdown({ version: PIPELINE_VERSION, generated_at, reports, summary, gate });
await writeFile(path.join(ROOT, "evals/reports", `${name}.md`), md);
if (updateBaseline) await writeFile(baselinePath, JSON.stringify(summary, null, 2) + "\n");
console.log(md.split("## Documents")[0]);
console.log(`${reports.length} documents in ${((performance.now() - started) / 1000).toFixed(1)} s · report evals/reports/${name}.md${updateBaseline ? " · baseline updated" : ""}`);
process.exit(gate.pass ? 0 : 1);
