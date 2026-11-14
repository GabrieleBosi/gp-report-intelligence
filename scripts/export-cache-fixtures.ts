// One-off (SPEC-public-release T7): runs the held-out split through the eval path, replaying recorded answers and
// copying any missing one from the live response cache (llm_cache) into tests/fixtures/llm, so the snapshot and
// `eval` can replay all 18 documents at $0 and without keys. Read-only on the database; no model client exists here.
// Usage: node scripts/export-cache-fixtures.ts   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env)
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createSupabaseLlmCache } from "../netlify/lib/llm-cache-store.ts";
import { createReplayOrCacheLlm } from "../netlify/lib/replay-llm.ts";
import { createAdminClient } from "../netlify/lib/supabase.ts";
import { FIXTURES, ROOT } from "../tests/support/dev-corpus.ts";
import { evaluateDev } from "./eval-lib.ts";

process.loadEnvFile(path.join(ROOT, ".env"));
const db = createAdminClient({ SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY });
if (!db) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed in .env");

const before = (await readdir(FIXTURES)).length;
const { reports, unevaluated } = await evaluateDev(createReplayOrCacheLlm(createSupabaseLlmCache(db), FIXTURES), "heldout");
const added = (await readdir(FIXTURES)).length - before;

console.log(`held-out: ${reports.length} evaluated, ${unevaluated.length} not; ${added} fixture(s) copied from llm_cache`);
if (unevaluated.length > 0) {
  console.error(`Answers missing from both the fixtures and llm_cache (record only after asking):\n  ${unevaluated.join("\n  ")}`);
  process.exit(1);
}
