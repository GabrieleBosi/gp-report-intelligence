import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decide } from "../../core/review/actions.ts";
import { buildReviewState } from "../../core/review/state.ts";
import { toStoredRun, type LocalRun } from "../../core/snapshot.ts";
import { fetchPortfolio, fetchReviewQueue, fetchRun, retryPosting, submitReview } from "../../src/lib/api.ts";
import { resetLocalReview } from "../../src/lib/local-review.ts";
import { ROOT } from "../support/dev-corpus.ts";

// SPEC-public-release W2: on the public site a visitor reviews the recorded queue in their own browser. The decision
// runs the server's code (handleReview, decide, postRun) against in-memory stores, and a reload resets it.
// The committed snapshot is served from disk, as the static host serves it.
let overrides: Record<string, unknown> = {}; // a snapshot file replaced in one test, by its path under /snapshot/
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const spaFallback = () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
beforeEach(() => {
  overrides = {};
  vi.stubGlobal("fetch", async (url: string) => {
    if (!url.startsWith("/snapshot/")) throw new Error(`unexpected request ${url}`);
    const file = url.slice("/snapshot/".length);
    if (file in overrides) return overrides[file] === null ? spaFallback() : json(overrides[file]);
    try {
      return new Response(await readFile(path.join(ROOT, "public", url)), { headers: { "content-type": "application/json" } });
    } catch {
      return spaFallback();
    }
  });
});
afterEach(() => { vi.unstubAllGlobals(); resetLocalReview(); });

const queue = async () => (await fetchReviewQueue()).items;
const local = async (id: string) => JSON.parse(await readFile(path.join(ROOT, "public/snapshot/local-runs", `${id}.json`), "utf8")) as LocalRun;
const analyst = "A visitor";

describe("reviewing the recorded queue in the browser", () => {
  it("accepts the flagged figures, approves, posts: the run leaves the queue and its record joins the portfolio", async () => {
    const item = (await queue()).find((i) => i.status === "needs_review" && i.filename.includes("scan"));
    if (!item) throw new Error("the snapshot has no scanned run waiting for review");
    const before = await fetchRun(item.run_id);
    const versionsBefore = (await fetchPortfolio()).flatMap((g) => g.history).length;

    for (const { path: field } of buildReviewState(toStoredRun(await local(item.run_id))).pendingKeyFigures) {
      expect(await submitReview(item.run_id, { analyst, seen_status: "needs_review", action: { kind: "accept_field", field } })).toEqual({ ok: true });
    }
    expect(await submitReview(item.run_id, { analyst, seen_status: "needs_review", action: { kind: "approve", reason: "Checked against the page." } }))
      .toEqual({ ok: true });

    const after = await fetchRun(item.run_id);
    expect(after.run.status).toBe("posted");
    expect(after.decisions.length).toBeGreaterThan(before.decisions.length);
    expect(after.decisions.at(-1)).toMatchObject({ kind: "approved", analyst, reason: "Checked against the page." });
    expect(after.posting.attempts.at(-1)).toMatchObject({ outcome: expect.stringMatching(/^(posted|unchanged)$/) });
    expect(after.posting.record?.cleared).toEqual({ by: "analyst", analyst, reason: "Checked against the page." });
    expect((await queue()).map((i) => i.run_id)).not.toContain(item.run_id);
    if (after.posting.attempts.at(-1)?.outcome === "posted") {
      expect((await fetchPortfolio()).flatMap((g) => g.history).length).toBe(versionsBefore + 1);
    }
  });

  it("reaches the status decide() gives for every queued run", async () => {
    for (const item of await queue()) {
      const state = buildReviewState(toStoredRun(await local(item.run_id)));
      const action = { kind: "reject" as const, reason: "Not this quarter's report." };
      const expected = decide(state, action, analyst);
      const result = await submitReview(item.run_id, { analyst, seen_status: item.status, action });
      expect(result.ok, item.filename).toBe(expected.ok);
      if (expected.ok) expect((await fetchRun(item.run_id)).run.status, item.filename).toBe(expected.value.nextStatus);
    }
  });

  it("refuses a decision made on a view that is no longer current", async () => {
    const [item] = await queue();
    if (!item) throw new Error("empty queue");
    await submitReview(item.run_id, { analyst, seen_status: item.status, action: { kind: "reject", reason: "Duplicate." } });
    const stale = await submitReview(item.run_id, { analyst, seen_status: item.status, action: { kind: "reject", reason: "Again." } });
    expect(stale).toMatchObject({ ok: false, message: expect.stringMatching(/changed since you opened it/) });
  });

  it("assigns an unknown GP's report to a registry fund, which moves it from triage to review", async () => {
    const item = (await queue()).find((i) => i.status === "needs_triage");
    if (!item) throw new Error("the snapshot has no triage run");
    const [fund] = (await local(item.run_id)).knownFunds;
    expect(await submitReview(item.run_id, { analyst, seen_status: "needs_triage", action: { kind: "assign_fund", fundId: fund?.id ?? "" } }))
      .toEqual({ ok: true });
    expect((await fetchRun(item.run_id)).run.status).toBe("needs_review");
    expect((await queue()).find((i) => i.run_id === item.run_id)?.status).toBe("needs_review");
  });

  it("forgets everything on reload", async () => {
    const [item] = await queue();
    if (!item) throw new Error("empty queue");
    await submitReview(item.run_id, { analyst, seen_status: item.status, action: { kind: "reject", reason: "Duplicate." } });
    resetLocalReview();
    expect((await fetchRun(item.run_id)).run.status).toBe(item.status);
    expect((await queue()).map((i) => i.run_id)).toContain(item.run_id);
  });

  // Review findings (checkpoint C): the browser must post as the server does, whatever the extracted spelling.
  const CHART = "8c2a360e-9a89-42e3-a3c7-1071a67e055b"; // alpenrose-iv-2025q3-chart-nav: the NAV waits for an analyst
  const ALPENROSE = "d15ba5d1-9fdf-4d1f-8191-135aa6277a5c";
  async function withEarlierVersion() {
    const run = await local(CHART);
    const extraction = run.latest.extraction as unknown as { classification: Record<string, unknown> };
    extraction.classification = { ...extraction.classification, fund_name: "Alpenrose IV" }; // the registry's alias
    const portfolio = JSON.parse(await readFile(path.join(ROOT, "public/snapshot/api/portfolio.json"), "utf8")) as { records: object[] };
    const v1 = { fund_id: ALPENROSE, fund_name: "Alpenrose Buyout IV", gp_name: "Alpenrose Capital", period_end: "2025-09-30", version: 1,
      posted_at: "2026-10-11T09:00:00.000Z", source_run: "7bc2ccb5-5b9b-4315-9fa6-a7cc85df4bd9", currency: "EUR", nav: 400000000,
      tvpi: 1.3, dpi: 0.1, cleared: { by: "auto_post", policy: "policy@3" }, superseded: false };
    const records = JSON.parse(await readFile(path.join(ROOT, "public/snapshot/portfolio-records.json"), "utf8")) as object[];
    overrides = {
      [`local-runs/${CHART}.json`]: run,
      "api/portfolio.json": { records: [...portfolio.records, { fund_name: v1.fund_name, gp_name: v1.gp_name, period_end: v1.period_end, current: v1, history: [v1] }] },
      "portfolio-records.json": [...records, { fund_id: ALPENROSE, period_end: "2025-09-30", version: 1, source_run: v1.source_run, figures_hash: "older" }],
    };
  }
  const approveChart = async () => {
    await submitReview(CHART, { analyst, seen_status: "needs_review", action: { kind: "accept_field", field: "fund.nav" } });
    return submitReview(CHART, { analyst, seen_status: "needs_review", action: { kind: "approve" } });
  };

  it("supersedes the recorded version of the same fund and quarter, even when the report spells the fund by an alias", async () => {
    await withEarlierVersion();
    expect(await approveChart()).toEqual({ ok: true });
    const groups = (await fetchPortfolio()).filter((g) => g.period_end === "2025-09-30" && g.gp_name === "Alpenrose Capital");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.current).toMatchObject({ version: 2, superseded: false });
    expect(groups[0]?.history.map((r) => [r.version, r.superseded])).toEqual([[2, false], [1, true]]);
  });

  it("fails the posting, and keeps it retryable, when the portfolio system's records cannot be read", async () => {
    await withEarlierVersion();
    overrides["portfolio-records.json"] = null; // the host answers with the app's page
    expect(await approveChart()).toEqual({ ok: true });
    const run = await fetchRun(CHART);
    expect(run.run.status).toBe("approved");
    expect(run.posting.attempts.at(-1)).toMatchObject({ outcome: "failed", version: null });
    expect((await fetchPortfolio()).filter((g) => g.period_end === "2025-09-30" && g.gp_name === "Alpenrose Capital").map((g) => g.current.version)).toEqual([1]);
  });

  it("shows a correction as the analyst's round, and posts the corrected figure", async () => {
    const before = await fetchRun(CHART);
    expect(await submitReview(CHART, { analyst, seen_status: "needs_review", action: { kind: "correct", field: "fund.nav", raw: "431.2", page: 1 } }))
      .toEqual({ ok: true });
    const corrected = await fetchRun(CHART);
    expect(corrected.extraction?.round).toBe(Math.max((before.extraction?.round ?? 0) + 1, 3));
    expect(JSON.stringify(corrected.extraction)).toContain("431.2");
    expect(await submitReview(CHART, { analyst, seen_status: "needs_review", action: { kind: "approve" } })).toEqual({ ok: true });
    const row = (await fetchPortfolio()).find((g) => g.period_end === "2025-09-30" && g.gp_name === "Alpenrose Capital")?.current;
    expect(row).toMatchObject({ nav: 431200000, version: 1, cleared: { by: "analyst", analyst } });
  });

  it("keeps both of two decisions sent before the run was first loaded", async () => {
    const item = (await queue()).find((i) => i.filename.includes("restatement"));
    if (!item) throw new Error("the snapshot has no restatement waiting for review");
    const accept = (field: string) => submitReview(item.run_id, { analyst, seen_status: "needs_review", action: { kind: "accept_field", field } });
    expect(await Promise.all([accept("fund.nav"), accept("fund.tvpi")])).toEqual([{ ok: true }, { ok: true }]);
    expect((await fetchRun(item.run_id)).decisions.slice(-2).map((d) => d.field).sort()).toEqual(["fund.nav", "fund.tvpi"]);
  });

  it("answers a retry on a run that is not in the queue with the server's refusal", async () => {
    expect(await retryPosting("0c3dac74-82ec-440a-8c8c-743a45b7e8ca")).toMatchObject({ ok: false });
  });
});
