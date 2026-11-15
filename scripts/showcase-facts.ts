// npm run showcase:facts -- <archive path> <owner/repo>: writes src/generated/build-facts.json for the process page
// (SPEC-showcase decision 4: regenerated on purpose and committed, so the site shows stable numbers). Local only. Commits
// and CI runs are read from the development history in the private archive, read-only (git log in its working copy,
// GitHub Actions through gh); tests are counted in this repository; spend comes from the LLM usage ledger (service key
// from .env). The archive's path and name are arguments, so neither is written into this repository.
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { POLICY } from "../core/confidence/policy.ts";
import { PIPELINE_VERSION } from "../core/pipeline/version.ts";
import { allRows, createAdminClient } from "../netlify/lib/supabase.ts";
import { ciSummary, commitsByDay, commitTypes, type BuildFacts, type CiRun } from "../src/showcase/facts.ts";
import { ROOT } from "../tests/support/dev-corpus.ts";

const [archive, archiveRepo] = process.argv.slice(2);
if (!archive || !archiveRepo) throw new Error("usage: npm run showcase:facts -- <archive path> <owner/repo>");
const run = (cmd: string, args: string[], cwd = ROOT) => execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const log = run("git", ["log", "--format=%aI%x09%s"], archive).trim().split("\n").map((l) => l.split("\t") as [string, string]);
const commits = { total: log.length, first: log.at(-1)?.[0] ?? "", last: log[0]?.[0] ?? "",
  byType: commitTypes(log.map(([, s]) => s)), byDay: commitsByDay(log.map(([d]) => d)) };

const out = path.join(ROOT, "node_modules/.cache/showcase-vitest.json");
await mkdir(path.dirname(out), { recursive: true });
try { run("npx", ["vitest", "run", "--reporter=json", `--outputFile=${out}`]); } catch { /* a failing suite still reports its counts */ }
const vitest = JSON.parse(await readFile(out, "utf8")) as { numTotalTests: number; numFailedTests: number; testResults: unknown[] };
await rm(out);
if (vitest.numFailedTests > 0) throw new Error(`${vitest.numFailedTests} unit tests fail: fix them before generating facts`);

// Browser tests as Playwright lists them (tests made in a loop included), for the live and the public-site configuration.
const listed = (config: string) => Number(run("npx", ["playwright", "test", "--list", "-c", config]).match(/Total: (\d+) tests?/)?.[1] ?? NaN);
const e2e = listed("playwright.config.ts") + listed("playwright.snapshot.config.ts");
const sqlContracts = (await readdir(path.join(ROOT, "supabase/tests"))).filter((f) => f.endsWith(".sql")).length;

const ci = ciSummary(JSON.parse(run("gh", ["run", "list", "--repo", archiveRepo, "--limit", "1000", "--json", "conclusion,headBranch,createdAt"])) as CiRun[]);

process.loadEnvFile(path.join(ROOT, ".env"));
const db = createAdminClient(process.env);
let llm: BuildFacts["llm"] = null;
if (db) {
  const rows = await allRows<{ cost_usd: number; created_at: string }>(db, "usage_ledger", "cost_usd, created_at", "created_at");
  llm = { calls: rows.length, costUsd: Math.round(rows.reduce((s, r) => s + Number(r.cost_usd), 0) * 100) / 100, first: rows[0]?.created_at ?? null };
}

const facts: BuildFacts = {
  generated_at: new Date().toISOString(), pipeline: PIPELINE_VERSION, policy: POLICY.version, commits,
  tests: { unit: vitest.numTotalTests, unitFiles: vitest.testResults.length, e2e, sqlContracts }, ci, llm,
};
await mkdir(path.join(ROOT, "src/generated"), { recursive: true });
await writeFile(path.join(ROOT, "src/generated/build-facts.json"), `${JSON.stringify(facts, null, 2)}\n`);
console.log(JSON.stringify(facts, null, 2));
