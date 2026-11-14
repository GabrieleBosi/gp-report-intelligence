// Runs corpus documents end to end on the DEPLOYED site and compares them with their labels. Spends money (the live
// pipeline is budget-guarded). Usage: node scripts/acceptance.ts <dev|heldout|all|doc_id,doc_id...> [base-url]
// Output: a markdown table on stdout and the raw results in docs/acceptance/<date>-<split>.json.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CorpusLabel } from "../core/schema.ts";
import { RunView } from "../core/pipeline/run-view.ts";

const root = path.resolve(import.meta.dirname, "..");
process.loadEnvFile(path.join(root, ".env"));
const split = process.argv[2] ?? "heldout";
const base = process.argv[3] ?? "https://gp-report-intelligence.netlify.app";

// The live functions need the owner's access key (ADR-0006).
const key = process.env.LIVE_ACCESS_KEY;
if (!key) throw new Error("LIVE_ACCESS_KEY missing from .env");
// The live site limits requests per IP (SPEC-public-release W2): on a 429 wait for the window to pass, then retry.
async function api(p: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${base}${p}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${key}` } });
    if (response.status !== 429 || attempt === 5) return response;
    console.log(`rate limited on ${p}; waiting 60 s`);
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

const labels = (await Promise.all((await readdir(path.join(root, "corpus/labels"))).sort().map(async (n) =>
  CorpusLabel.parse(JSON.parse(await readFile(path.join(root, "corpus/labels", n), "utf8"))))))
  .filter((l) => split === "all" || l.split === split || split.split(",").includes(l.doc_id));
const documents = (await (await api("/api/documents")).json()).documents as { id: string; filename: string }[];

function differences(a: unknown, b: unknown, at = ""): string[] {
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at ? `${at}.${k}` : k));
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.flatMap((x, i) => differences(x, b[i], `${at}[${i}]`));
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [at];
}

const results = [];
for (const label of labels) {
  const doc = documents.find((d) => d.filename === path.basename(label.file));
  if (!doc) throw new Error(`${label.doc_id} is not on the site (npm run corpus:seed)`);
  const created = await (await api("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document_id: doc.id }) })).json();
  await api(`/api/runs/${created.run_id}/execute`, { method: "POST" });
  let view: RunView | null = null;
  for (let i = 0; i < 120; i++) {
    view = RunView.parse(await (await api(`/api/runs/${created.run_id}`)).json());
    if (!["queued", "running"].includes(view.run.status)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!view) throw new Error("no view");
  const extraction = view.extraction?.extraction ?? null;
  const diffs = extraction ? differences(extraction, label.expected) : ["(no extraction)"];
  const route = view.assessment?.route ?? null;
  const cost = view.steps.reduce((s, st) => s + (typeof st.details.costUsd === "number" ? st.details.costUsd : 0), 0);
  const seconds = view.run.started_at && view.run.finished_at ? (Date.parse(view.run.finished_at) - Date.parse(view.run.started_at)) / 1000 : null;
  results.push({
    doc_id: label.doc_id, split: label.split, trap: label.trap ?? null, run_id: created.run_id, status: view.run.status,
    pipeline: view.run.pipeline_version, expected_route: label.expected_route, route, route_ok: route === label.expected_route,
    differences: diffs, unsafe: route === "auto_post" && diffs.length > 0, cost_usd: Math.round(cost * 1e4) / 1e4, seconds,
    reasons: view.assessment?.reasons ?? [view.run.error ?? ""],
  });
  console.error(`done ${label.doc_id}: ${view.run.status}`);
}

console.log(`| Document | Split | Expected | Route | Match | Differences vs label | Unsafe | Cost | Time |\n|---|---|---|---|---|---|---|---|---|`);
for (const r of results) {
  console.log(`| ${r.doc_id} | ${r.split} | ${r.expected_route} | ${r.route ?? r.status} | ${r.route_ok ? "yes" : "**no**"} | ${r.differences.length} | ${r.unsafe ? "**YES**" : "no"} | $${r.cost_usd.toFixed(4)} | ${r.seconds?.toFixed(1) ?? "?"} s |`);
}
await mkdir(path.join(root, "docs/acceptance"), { recursive: true });
// The pipeline version is part of the name: a later measurement never overwrites earlier evidence.
const version = results[0]?.pipeline.replace("@", "-") ?? "unknown";
const out = path.join(root, "docs/acceptance", `${new Date().toISOString().slice(0, 10)}-${split.includes(",") ? "selected" : split}-${version}.json`);
await writeFile(out, JSON.stringify(results, null, 2) + "\n");
console.error(`saved ${path.relative(root, out)}`);
