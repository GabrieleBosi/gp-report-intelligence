// npm run snapshot (SPEC-public-release W2, ADR-0006): exports the live history to public/snapshot/, the static data
// the public site reads. Local and owner only (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env), and read-only:
// the responses come from the API's own GET handlers and read adapters, so the snapshot is what the API returned.
// Uploaded documents and their runs are left out. Page images are rendered from the corpus files at the pipeline's
// resolution, so nothing is written to the page cache.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { VISION_DPI } from "../core/pipeline/extract.ts";
import { buildQueue } from "../core/review/queue.ts";
import { computeMetrics } from "../core/showcase/metrics.ts";
import { RunView } from "../core/pipeline/run-view.ts";
import type { PortfolioGroup } from "../core/posting/portfolio-view.ts";
import { corpusOnly, corpusPortfolio, uuidsIn, type ExportRows, type LocalRun, type PortfolioEntry } from "../core/snapshot.ts";
import { createSupabasePostingLoader } from "../netlify/lib/posting-store.ts";
import { createSupabaseReviewStore } from "../netlify/lib/review-store.ts";
import { createSupabaseKnownFundRegistry } from "../netlify/lib/run-store.ts";
import { countPages, renderPageToPng } from "../netlify/lib/pdf.ts";
import { createAdminClient } from "../netlify/lib/supabase.ts";
import { DEMO_RUNS } from "../src/showcase/content.ts";
import { ROOT } from "../tests/support/dev-corpus.ts";

process.loadEnvFile(path.join(ROOT, ".env"));
const maybeDb = createAdminClient({ SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY });
if (!maybeDb) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed in .env");
const db = maybeDb;

// The handlers read their configuration from the Netlify global; a one-time key passes their access check.
const key = randomBytes(32).toString("hex");
Object.assign(globalThis, { Netlify: { env: { get: (name: string) => (name === "LIVE_ACCESS_KEY" ? key : process.env[name]) } } });
type Handler = (req: Request, context: unknown) => Promise<Response>;
const handler = async (name: string) => (await import(`../netlify/functions/${name}.ts`)).default as Handler;
async function get(fn: Handler, url: string, params: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const response = await fn(new Request(`http://snapshot${url}`, { headers: { authorization: `Bearer ${key}` } }), { params });
  return { status: response.status, body: await response.json() };
}

const OUT = path.join(ROOT, "public/snapshot");
await rm(OUT, { recursive: true, force: true });
async function save(rel: string, body: unknown) {
  await mkdir(path.dirname(path.join(OUT, rel)), { recursive: true });
  await writeFile(path.join(OUT, rel), JSON.stringify(body) + "\n");
}

// Documents: the corpus only.
const docs = await get(await handler("documents"), "/api/documents");
if (docs.status !== 200) throw new Error(`documents: HTTP ${docs.status}`);
const documents = (docs.body as { documents: { id: string; filename: string; source: string }[] }).documents.filter((d) => d.source === "corpus");
const corpusIds = new Set(documents.map((d) => d.id));
await save("api/documents.json", { documents });

// Review queue and funds, through the review handler's own code path.
const review = createSupabaseReviewStore(db);
const queue = buildQueue((await review.queueRows()).filter((r) => corpusIds.has(r.document_id)));
await save("api/review/queue.json", queue);
const funds = await get(await handler("review"), "/api/review/funds");
if (funds.status !== 200) throw new Error(`funds: HTTP ${funds.status}`);
await save("api/review/funds.json", funds.body);

// Metrics from the same rows the metrics function reads, without the upload.
async function rows<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (data.length < 1000) return out;
  }
}
const exportRows: ExportRows = {
  documents: await rows("documents", "id, source"),
  pipeline_runs: await rows("pipeline_runs", "id, status, document_id"),
  assessments: await rows("assessments", "run_id, round, route"),
  review_decisions: await rows("review_decisions", "kind, run_id"),
  postings: await rows("postings", "outcome, run_id"),
  portfolio_records: await rows("portfolio_records", "version, source_run"),
  usage_ledger: await rows("usage_ledger", "cost_usd, step, run_id"),
};
const corpusRows = corpusOnly(exportRows);
await save("api/metrics.json", computeMetrics(corpusRows, new Date()));

// The portfolio without the versions posted from uploads.
const portfolioResponse = await get(await handler("portfolio"), "/api/portfolio");
if (portfolioResponse.status !== 200) throw new Error(`portfolio: HTTP ${portfolioResponse.status}`);
const portfolio = { records: corpusPortfolio((portfolioResponse.body as { records: PortfolioGroup[] }).records,
  new Set(corpusRows.pipeline_runs.map((r) => r.id))) };
await save("api/portfolio.json", portfolio);

// Runs: everything the tour, the queue and the portfolio link to, then whatever those runs link to, until closed.
const runsFn = await handler("runs");
const runDocument = new Map<string, string>(); // run id -> filename
const pending = [...Object.values(DEMO_RUNS).map((r) => r.id), ...uuidsIn(queue), ...uuidsIn(portfolio)];
const seen = new Set<string>();
for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
  if (seen.has(id)) continue;
  seen.add(id);
  const view = await get(runsFn, `/api/runs/${id}`, { id });
  if (view.status === 404 || view.status === 400) continue; // a fund, record or document id, not a run
  if (view.status !== 200) throw new Error(`run ${id}: HTTP ${view.status}`);
  const run = view.body as { run: { document_id: string }; document: { filename: string } };
  if (!corpusIds.has(run.run.document_id)) throw new Error(`run ${id} belongs to an uploaded document; the snapshot leaves uploads out`);
  runDocument.set(id, run.document.filename);
  await save(`api/runs/${id}.json`, view.body);
  pending.push(...uuidsIn(view.body));
}

// The queued runs as the review in the browser needs them (ADR-0006): what the review store and the posting loader
// read, merged with the exported run view (full decisions, extraction round, posting attempts).
const knownFunds = await createSupabaseKnownFundRegistry(db).list();
const loadPosting = createSupabasePostingLoader(db);
for (const { run_id } of queue.items) {
  const [stored, posting] = [await review.loadStored(run_id, knownFunds), await loadPosting(run_id)];
  if (!stored) throw new Error(`queued run ${run_id} has nothing to review`);
  if (!posting) throw new Error(`queued run ${run_id} has no document hash to post with`);
  const view = RunView.parse(JSON.parse(await readFile(path.join(OUT, `api/runs/${run_id}.json`), "utf8")));
  const local: LocalRun = {
    run: { id: run_id, status: stored.run.status, pipeline_version: view.run.pipeline_version },
    documentSha256: posting.documentSha256, classify: stored.classify, pageCount: stored.pageCount,
    latest: { ...stored.latest, round: view.extraction?.round ?? 0 }, assessment: stored.assessment,
    decisions: view.decisions, knownFunds, postings: view.posting.attempts,
  };
  await save(`local-runs/${run_id}.json`, local);
}
const entries = await rows<PortfolioEntry>("portfolio_records", "fund_id, period_end, version, source_run, figures_hash");
await save("portfolio-records.json", entries.filter((e) => runDocument.has(e.source_run)));

// Page images, once per document.
const pages: Record<string, number> = {};
for (const filename of new Set(runDocument.values())) {
  if (!filename.endsWith(".pdf")) continue;
  const pdf = new Uint8Array(await readFile(path.join(ROOT, "corpus/docs", filename)));
  pages[filename] = await countPages(pdf);
  for (let page = 1; page <= pages[filename]; page++) {
    const png = await renderPageToPng(pdf, page, VISION_DPI);
    await mkdir(path.join(OUT, "pages", filename), { recursive: true });
    await writeFile(path.join(OUT, "pages", filename, `${page}.png`), png);
  }
}

await save("index.json", {
  exported_at: new Date().toISOString(),
  runs: Object.fromEntries([...runDocument].sort().map(([id, filename]) => [id, { filename, pages: pages[filename] ?? 0 }])),
});
console.log(`snapshot: ${documents.length} documents, ${runDocument.size} runs, ${queue.items.length} queued, ` +
  `${Object.values(pages).reduce((a, b) => a + b, 0)} page images`);
