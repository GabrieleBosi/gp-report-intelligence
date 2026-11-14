import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunView } from "../../core/pipeline/run-view.ts";
import { buildReviewState } from "../../core/review/state.ts";
import { toStoredRun, type LocalRun, type PortfolioEntry } from "../../core/snapshot.ts";
import { Metrics } from "../../core/showcase/metrics.ts";
import { DocumentsResponse, FundsResponse, PortfolioResponse, QueueResponse } from "../../src/lib/api.ts";
import { DEMO_RUNS } from "../../src/showcase/content.ts";
import { ROOT } from "../support/dev-corpus.ts";

// The committed public snapshot (SPEC-public-release W2): it must satisfy the schemas the app validates API responses
// with, contain every run the site links to, and leave uploads out. Re-run npm run snapshot, then this test.
const DIR = path.join(ROOT, "public/snapshot");
const read = (rel: string): unknown => JSON.parse(readFileSync(path.join(DIR, rel), "utf8"));
const runFiles = readdirSync(path.join(DIR, "api/runs")).map((f) => f.replace(/\.json$/, ""));
const index = read("index.json") as { exported_at: string; runs: Record<string, { filename: string; pages: number }> };

describe("the public snapshot", () => {
  it("lists the 18 corpus documents and no upload", () => {
    const { documents } = DocumentsResponse.parse(read("api/documents.json"));
    expect(documents).toHaveLength(18);
    expect(documents.every((d) => d.source === "corpus")).toBe(true);
  });

  it("has a valid run view for every run, each on a corpus document", () => {
    const corpus = new Set(DocumentsResponse.parse(read("api/documents.json")).documents.map((d) => d.id));
    for (const id of runFiles) {
      const view = RunView.parse(read(`api/runs/${id}.json`));
      expect(view.run.id).toBe(id);
      expect(corpus.has(view.run.document_id), `run ${id}`).toBe(true);
    }
  });

  it("contains every run the tour, the review queue and the portfolio link to", () => {
    const queue = QueueResponse.parse(read("api/review/queue.json"));
    const { records } = PortfolioResponse.parse(read("api/portfolio.json"));
    const linked = [...Object.values(DEMO_RUNS).map((r) => r.id), ...queue.items.map((i) => i.run_id),
      ...records.flatMap((g) => g.history).map((r) => r.source_run)];
    for (const id of linked) expect(runFiles, `linked run ${id}`).toContain(id);
  });

  it("indexes exactly the exported runs, with the page images of each PDF", () => {
    expect(Object.keys(index.runs).sort()).toEqual([...runFiles].sort());
    for (const { filename, pages } of Object.values(index.runs)) {
      if (!filename.endsWith(".pdf")) continue;
      expect(pages, filename).toBeGreaterThan(0);
      for (let p = 1; p <= pages; p++) expect(existsSync(path.join(DIR, "pages", filename, `${p}.png`)), `${filename} p${p}`).toBe(true);
    }
  });

  it("has every queued run as a local run that the server's own review rules accept", () => {
    for (const { run_id } of QueueResponse.parse(read("api/review/queue.json")).items) {
      const local = read(`local-runs/${run_id}.json`) as LocalRun;
      expect(local.run.id).toBe(run_id);
      expect(buildReviewState(toStoredRun(local)).status, run_id).toMatch(/^needs_(review|triage)$/);
      expect(local.documentSha256, run_id).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("has the portfolio's records with their figures hashes, one per version shown", () => {
    const entries = read("portfolio-records.json") as PortfolioEntry[];
    const shown = PortfolioResponse.parse(read("api/portfolio.json")).records.flatMap((g) => g.history); // history includes current
    expect(entries).toHaveLength(shown.length);
    for (const e of entries) expect(e.figures_hash, e.source_run).toMatch(/^[0-9a-f]{64}$/);
  });

  it("has funds and metrics in the API's shape, with no upload counted", () => {
    expect(FundsResponse.parse(read("api/review/funds.json")).funds.length).toBeGreaterThan(0);
    const metrics = Metrics.parse(read("api/metrics.json"));
    expect(metrics.documents).toMatchObject({ total: 18, corpus: 18, upload: 0 });
  });

  it("stays under the 10 MB budget", () => {
    const size = (p: string): number => statSync(p).isDirectory() ? readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0) : statSync(p).size;
    expect(size(DIR)).toBeLessThan(10 * 1024 * 1024);
  });
});
