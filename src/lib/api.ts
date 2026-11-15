import { z } from "zod";
import { DocumentSummary } from "../../core/documents.ts";
import { RunView, type RunRecord } from "../../core/pipeline/run-view.ts";
import type { ReviewRequest } from "../../core/review/api.ts";
import { Metrics } from "../../core/showcase/metrics.ts";
import { publicPostingError } from "../../core/posting/post.ts";
import { isLive, liveKey } from "./access.ts";
import { isJson } from "./json-response.ts";
import { overlayPortfolio, overlayQueue, overlayRun, retryLocally, reviewLocally } from "./local-review.ts";

export const DocumentsResponse = z.object({ documents: z.array(DocumentSummary) });
const ErrorBody = z.object({ error: z.string() });

// Server errors carry a user-facing { error } message; fall back to the HTTP status when they do not.
async function failure(response: Response, fallback: string): Promise<Error> {
  const body = ErrorBody.safeParse(await response.json().catch(() => null));
  return new Error(body.success ? body.data.error : `${fallback} (HTTP ${response.status})`);
}

// Two modes (SPEC-public-release W2, ADR-0006): by default every read comes from the recorded snapshot, a static copy of
// the API's responses; with the owner's key, calls go to the live functions with the key as a bearer token.
export const SNAPSHOT_ONLY = "This public site shows recorded runs. Running the pipeline needs the owner's access key.";

function live(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${liveKey() ?? ""}` } });
}

async function read(path: string, signal?: AbortSignal): Promise<Response> {
  if (isLive()) return live(path, { signal });
  const response = await fetch(`/snapshot${path}.json`, { signal });
  return response.ok && !isJson(response) ? new Response(null, { status: 404 }) : response; // the SPA fallback: missing
}

// Page images: per document in the snapshot. Live, the page-image function renders them, and since an <img> cannot
// send the key the image is fetched (fetchPageImage) and shown from a blob: URL.
export function pageImageUrl(filename: string, page: number): string {
  return `/snapshot/pages/${encodeURIComponent(filename)}/${page}.png`;
}

export async function fetchPageImage(runId: string, page: number, signal?: AbortSignal): Promise<Blob> {
  const response = await live(`/api/runs/${runId}/pages/${page}`, { signal });
  if (!response.ok) throw await failure(response, "Could not load the page image");
  return response.blob();
}

// Checks a key against the live functions before the site switches to them: only their JSON answer counts, and a
// degraded backend (503) is reported, not refused.
export async function verifyLiveKey(key: string): Promise<{ ok: true; warning?: string } | { ok: false; message: string }> {
  const response = await fetch("/api/health", { headers: { authorization: `Bearer ${key}` } });
  if (response.status === 401) return { ok: false, message: (await failure(response, "The key was refused")).message };
  if (response.ok) return isJson(response) ? { ok: true }
    : { ok: false, message: "Live mode is not available here: the health check answered with a page, not the API." };
  // 503 is the health check's own answer when a dependency is down: the key was accepted. Anything else means the live
  // functions are not there to check it (a 404 on a plain static server), so the key proves nothing.
  if (response.status === 503) return { ok: true, warning: "The live backend reports a problem (HTTP 503)." };
  return { ok: false, message: `Live mode is not available here: the health check answered HTTP ${response.status}.` };
}

// Responses are validated with the same schemas the server uses, so a contract break shows up as a clear error.
export async function fetchDocuments(signal?: AbortSignal): Promise<DocumentSummary[]> {
  const response = await read("/api/documents", signal);
  if (!response.ok) throw await failure(response, "Could not load documents");
  return DocumentsResponse.parse(await response.json()).documents;
}

// Two calls by design (see netlify/functions/runs.ts): create the run, then start it in a background function.
export async function startRun(documentId: string): Promise<string> {
  if (!isLive()) throw new Error(SNAPSHOT_ONLY);
  const created = await live("/api/runs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document_id: documentId }),
  });
  if (!created.ok) throw await failure(created, "Could not create the run");
  const { run_id: runId } = z.object({ run_id: z.string() }).parse(await created.json());

  const started = await live(`/api/runs/${runId}/execute`, { method: "POST" });
  if (!started.ok) throw await failure(started, "Could not start the run");
  return runId;
}

export async function fetchRun(runId: string, signal?: AbortSignal): Promise<RunView> {
  const response = await read(`/api/runs/${runId}`, signal);
  if (!isLive() && response.status === 404) throw new Error("This run is not in the recorded snapshot.");
  if (!response.ok) throw await failure(response, "Could not load the run");
  const view = RunView.parse(await response.json());
  return isLive() ? view : overlayRun(view);
}

// Poll while the run can still change; stop once it reaches any terminal status.
export function pollDelayMs(status: RunRecord["status"]): number | null {
  return status === "queued" || status === "running" ? 1500 : null;
}

const UploadAccepted = z.object({ document: DocumentSummary, duplicate: z.boolean() });
export type UploadOutcome = { ok: true; document: DocumentSummary; duplicate: boolean } | { ok: false; message: string };

// Turns the upload response into what the UI shows; every rejection carries the server's message.
export function parseUploadResponse(status: number, body: unknown): UploadOutcome {
  if (status === 200 || status === 201) {
    const accepted = UploadAccepted.safeParse(body);
    if (accepted.success) return { ok: true, ...accepted.data };
  }
  const error = ErrorBody.safeParse(body);
  if (error.success) return { ok: false, message: error.data.error };
  return { ok: false, message: status === 413 ? "The file is too large to upload." : `The upload failed (HTTP ${status || "network error"}).` };
}

// XMLHttpRequest rather than fetch: only it reports upload progress.
export function uploadDocument(file: File, onProgress: (fraction: number) => void): Promise<UploadOutcome> {
  if (!isLive()) return Promise.resolve({ ok: false, message: SNAPSHOT_ONLY });
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("authorization", `Bearer ${liveKey() ?? ""}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      resolve(parseUploadResponse(xhr.status, body));
    };
    xhr.onerror = () => resolve(parseUploadResponse(0, null));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export const QueueResponse = z.object({
  items: z.array(z.object({ run_id: z.string(), filename: z.string(), status: z.enum(["needs_review", "needs_triage"]),
    created_at: z.string(), fund_name: z.string().nullable(), period_end: z.string().nullable(), summary: z.string() })),
  counts: z.object({ needs_review: z.number(), needs_triage: z.number() }),
});
export type ReviewQueue = z.infer<typeof QueueResponse>;

export async function fetchReviewQueue(signal?: AbortSignal): Promise<ReviewQueue> {
  const response = await read("/api/review/queue", signal);
  if (!response.ok) throw await failure(response, "Could not load the review queue");
  const queue = QueueResponse.parse(await response.json());
  return isLive() ? queue : overlayQueue(queue);
}

export const FundsResponse = z.object({ funds: z.array(z.object({ id: z.string(), gp_name: z.string(), fund_name: z.string() })) });
export async function fetchFunds(signal?: AbortSignal) {
  const response = await read("/api/review/funds", signal);
  if (!response.ok) throw await failure(response, "Could not load the fund registry");
  return FundsResponse.parse(await response.json()).funds;
}

// One analyst decision; every refusal comes back with the server's message (stale view, missing reason, ...).
export async function submitReview(runId: string, request: z.infer<typeof ReviewRequest>): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isLive()) {
    const result = await reviewLocally(runId, request);
    return result.status === 200 ? { ok: true } : { ok: false, message: result.body.error };
  }
  const response = await live(`/api/runs/${runId}/review`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request),
  });
  return response.ok ? { ok: true } : { ok: false, message: (await failure(response, "The decision was not stored")).message };
}

// Step 8: retry posting a cleared run; the refusal message comes from the server.
export async function retryPosting(runId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isLive()) {
    const result = await retryLocally(runId);
    return result.ok ? { ok: true } : { ok: false, message: publicPostingError(result.error.code, result.error.message) };
  }
  const response = await live(`/api/runs/${runId}/post`, { method: "POST" });
  return response.ok ? { ok: true } : { ok: false, message: (await failure(response, "Posting failed")).message };
}

const Cleared = z.union([z.object({ by: z.literal("auto_post"), policy: z.string() }),
  z.object({ by: z.literal("analyst"), analyst: z.string(), reason: z.string().nullable() })]);
const RecordRow = z.object({ fund_id: z.string(), fund_name: z.string(), period_end: z.string(), version: z.number(), posted_at: z.string(), source_run: z.string(),
  currency: z.string(), nav: z.number().nullable(), tvpi: z.number().nullable(), dpi: z.number().nullable(), cleared: Cleared, superseded: z.boolean() });
export const PortfolioResponse = z.object({ records: z.array(z.object({ fund_name: z.string(), gp_name: z.string(), period_end: z.string(),
  current: RecordRow, history: z.array(RecordRow) })) });
export type PortfolioGroups = z.infer<typeof PortfolioResponse>["records"];

export async function fetchPortfolio(signal?: AbortSignal): Promise<PortfolioGroups> {
  const response = await read("/api/portfolio", signal);
  if (!response.ok) throw await failure(response, "Could not load the portfolio system");
  const { records } = PortfolioResponse.parse(await response.json());
  return isLive() ? records : PortfolioResponse.parse({ records: overlayPortfolio(records) }).records;
}

const SnapshotIndex = z.object({ exported_at: z.string() });
export async function fetchSnapshotInfo(signal?: AbortSignal): Promise<{ exportedAt: string }> {
  const response = await fetch("/snapshot/index.json", { signal });
  if (!response.ok) throw await failure(response, "Could not load the snapshot");
  return { exportedAt: SnapshotIndex.parse(await response.json()).exported_at };
}

export async function fetchMetrics(signal?: AbortSignal): Promise<Metrics> {
  const response = await read("/api/metrics", signal);
  if (!response.ok) throw await failure(response, "Could not load the operating numbers");
  return Metrics.parse(await response.json());
}
