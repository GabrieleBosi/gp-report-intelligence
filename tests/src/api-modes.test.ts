import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchDocuments, fetchFunds, fetchMetrics, fetchPageImage, fetchPortfolio, fetchReviewQueue, fetchRun, fetchSnapshotInfo, pageImageUrl, SNAPSHOT_ONLY,
  startRun, uploadDocument, verifyLiveKey,
} from "../../src/lib/api.ts";
import { isLive, setLiveKey } from "../../src/lib/access.ts";

// SPEC-public-release W2: the public site reads the recorded snapshot; only the owner's key switches to the live API.
type Call = { url: string; authorization: string | null };
function stubFetch(status = 200, body: unknown = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}
const RUN = "0c3dac74-82ec-440a-8c8c-743a45b7e8ca";
const KEY = "k".repeat(32);

afterEach(() => { vi.unstubAllGlobals(); setLiveKey(null); });

describe("snapshot mode (the default)", () => {
  it("is the mode when no key is set", () => {
    expect(isLive()).toBe(false);
  });

  it("reads every list and view from the snapshot files, never from /api", async () => {
    const calls = stubFetch(200, {});
    await Promise.allSettled([fetchDocuments(), fetchRun(RUN), fetchReviewQueue(), fetchFunds(), fetchPortfolio(), fetchMetrics()]);
    expect(calls.map((c) => c.url).sort()).toEqual([
      "/snapshot/api/documents.json", "/snapshot/api/metrics.json", "/snapshot/api/portfolio.json",
      "/snapshot/api/review/funds.json", "/snapshot/api/review/queue.json", `/snapshot/api/runs/${RUN}.json`,
    ]);
    expect(calls.every((c) => c.authorization === null)).toBe(true);
  });

  it("says a run is not in the snapshot instead of showing a bare 404", async () => {
    stubFetch(404, {});
    await expect(fetchRun(RUN)).rejects.toThrow("This run is not in the recorded snapshot.");
  });

  it("says the same when the host answers a missing file with the app's HTML page (the SPA fallback)", async () => {
    vi.stubGlobal("fetch", async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(fetchRun(RUN)).rejects.toThrow("This run is not in the recorded snapshot.");
  });

  it("refuses to start a run or upload, without sending anything", async () => {
    const calls = stubFetch();
    await expect(startRun("doc-1")).rejects.toThrow(SNAPSHOT_ONLY);
    expect(await uploadDocument(new File(["%PDF"], "r.pdf"), () => {})).toEqual({ ok: false, message: SNAPSHOT_ONLY });
    expect(calls).toEqual([]);
  });

  it("reads when the snapshot was exported, for the banner", async () => {
    const calls = stubFetch(200, { exported_at: "2026-11-14T16:00:00.000Z", runs: {} });
    expect(await fetchSnapshotInfo()).toEqual({ exportedAt: "2026-11-14T16:00:00.000Z" });
    expect(calls.map((c) => c.url)).toEqual(["/snapshot/index.json"]);
  });

  it("serves page images from the snapshot, per document", () => {
    expect(pageImageUrl("harbourline-ii-2025q3-tvpi-misprint.pdf", 2)).toBe("/snapshot/pages/harbourline-ii-2025q3-tvpi-misprint.pdf/2.png");
  });
});

describe("live mode (the owner's key is set)", () => {
  it("calls the API with the key as a bearer token", async () => {
    setLiveKey(KEY);
    const calls = stubFetch(200, { documents: [] });
    await fetchDocuments();
    expect(calls).toEqual([{ url: "/api/documents", authorization: `Bearer ${KEY}` }]);
  });

  it("goes back to the snapshot when the key is cleared", () => {
    setLiveKey(KEY);
    expect(isLive()).toBe(true);
    setLiveKey(null);
    expect(isLive()).toBe(false);
  });
});

describe("owner access", () => {
  it("accepts a key the live functions accept, and does not store it itself", async () => {
    const calls = stubFetch(200, { status: "ok" });
    expect(await verifyLiveKey(KEY)).toEqual({ ok: true });
    expect(calls).toEqual([{ url: "/api/health", authorization: `Bearer ${KEY}` }]);
    expect(isLive()).toBe(false);
  });

  it("accepts the key when the backend is degraded (503): the key is right, the warning is shown", async () => {
    stubFetch(503, { status: "degraded" });
    expect(await verifyLiveKey(KEY)).toEqual({ ok: true, warning: "The live backend reports a problem (HTTP 503)." });
  });

  it("refuses when the live functions are not there to check the key (a 404 or any other error), saying so", async () => {
    for (const status of [404, 429, 500]) {
      stubFetch(status, {});
      expect(await verifyLiveKey(KEY), String(status)).toEqual({ ok: false, message: `Live mode is not available here: the health check answered HTTP ${status}.` });
    }
  });

  it("refuses when the host answers the health check with the app's page (a static host's fallback)", async () => {
    vi.stubGlobal("fetch", async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await verifyLiveKey(KEY)).toEqual({ ok: false, message: "Live mode is not available here: the health check answered with a page, not the API." });
  });

  it("keeps the key only where the browser can keep it across the reload, and says when it cannot", () => {
    vi.stubGlobal("sessionStorage", { setItem: () => { throw new Error("blocked"); }, getItem: () => null, removeItem: () => {} });
    expect(setLiveKey(KEY)).toBe(false);
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => store.delete(k) });
    expect(setLiveKey(KEY)).toBe(true);
  });

  it("refuses a wrong key with the server's message", async () => {
    stubFetch(401, { error: "This needs the owner's access key. The public site reads a recorded snapshot." });
    expect(await verifyLiveKey("wrong")).toEqual({ ok: false, message: "This needs the owner's access key. The public site reads a recorded snapshot." });
  });

  it("fetches a live page image with the key, since an <img> cannot send it", async () => {
    setLiveKey(KEY);
    const calls: Call[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    });
    const image = await fetchPageImage(RUN, 2);
    expect(image.type).toBe("image/png");
    expect(calls).toEqual([{ url: `/api/runs/${RUN}/pages/2`, authorization: `Bearer ${KEY}` }]);
  });
});
