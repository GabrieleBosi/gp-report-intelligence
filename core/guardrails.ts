// Upload and run guardrails (SPEC-platform "Guardrails"). Pure: the upload function gathers the facts (bytes, page
// count, uploads in the last hour, an existing document with the same sha256) and these rules decide, each with a
// message the UI shows as is. Raising a limit is an "ask first" change.
import { SPREADSHEET_MIME } from "./documents.ts";
import { MAX_PAGES } from "./pipeline/parse.ts";

// 4 MB, not the spec's original 10 MB: measured 2026-10-11, Netlify cuts function request bodies off at about 4.5 MB of
// file (6 MB after base64), answering an empty 413 before our code runs. 4 MB keeps our clear message in front of that.
export const UPLOAD_LIMITS = { maxBytes: 4 * 1024 * 1024, maxPages: MAX_PAGES, maxPerHour: 30 } as const;

export type UploadCandidate = {
  filename: string;
  bytes: Uint8Array;
  pageCount: number | null; // PDFs only (counted by the adapter); null for workbooks
  uploadsLastHour: number; // site-wide
  duplicateOf: string | null; // id of a document with the same sha256, if any
};
export type GuardrailCode = "too_large" | "unsupported_type" | "too_many_pages" | "rate_limited" | "budget_exceeded";
export type UploadDecision =
  | { ok: true; mime: "application/pdf" | typeof SPREADSHEET_MIME; duplicateOf: string | null }
  | { ok: false; code: GuardrailCode; message: string };

const startsWith = (bytes: Uint8Array, text: string) => [...text].every((ch, i) => bytes[i] === ch.charCodeAt(0));
// Plain byte search (core stays free of Node APIs: the browser imports this module for the limits).
function contains(bytes: Uint8Array, text: string): boolean {
  const needle = [...text].map((ch) => ch.charCodeAt(0));
  outer: for (let i = bytes.indexOf(needle[0] ?? 0); i >= 0 && i <= bytes.length - needle.length; i = bytes.indexOf(needle[0] ?? 0, i + 1)) {
    for (let j = 1; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

// The content decides, never the file name: a PDF starts with %PDF-; a workbook is a zip whose directory lists
// xl/workbook.xml (a Word file or any other zip renamed to .xlsx is not one).
export function detectMime(bytes: Uint8Array): "application/pdf" | typeof SPREADSHEET_MIME | null {
  if (startsWith(bytes, "%PDF-")) return "application/pdf";
  if (startsWith(bytes, "PK\x03\x04") && contains(bytes, "xl/workbook.xml")) return SPREADSHEET_MIME;
  return null;
}

export function checkUpload(c: UploadCandidate): UploadDecision {
  const reject = (code: GuardrailCode, message: string): UploadDecision => ({ ok: false, code, message });
  if (c.bytes.byteLength > UPLOAD_LIMITS.maxBytes) {
    return reject("too_large", `${c.filename} is ${mb(c.bytes.byteLength)}; files up to ${UPLOAD_LIMITS.maxBytes / 1024 / 1024} MB are accepted.`);
  }
  const mime = detectMime(c.bytes);
  if (!mime) return reject("unsupported_type", `${c.filename} is not a PDF or Excel (.xlsx) file. Only those formats are accepted.`);
  if (c.pageCount !== null && c.pageCount > UPLOAD_LIMITS.maxPages) {
    return reject("too_many_pages", `${c.filename} has ${c.pageCount} pages; documents up to ${UPLOAD_LIMITS.maxPages} pages are accepted.`);
  }
  if (c.uploadsLastHour >= UPLOAD_LIMITS.maxPerHour) {
    return reject("rate_limited", `The site accepts ${UPLOAD_LIMITS.maxPerHour} uploads per hour and that limit is reached. Please try again later.`);
  }
  return { ok: true, mime, duplicateOf: c.duplicateOf };
}

// A run is refused up front once today's LLM spend reaches the cap (the budget decorator also guards every call).
export function checkRunBudget(spentTodayUsd: number, budgetUsd: number): { ok: true } | { ok: false; code: "budget_exceeded"; message: string } {
  return spentTodayUsd < budgetUsd ? { ok: true } : {
    ok: false, code: "budget_exceeded",
    message: `Today's AI budget of $${budgetUsd.toFixed(2)} is used up ($${spentTodayUsd.toFixed(2)} spent). Runs are possible again tomorrow (UTC).`,
  };
}
