import type { Cleared } from "../../core/posting/portfolio-view.ts";

export type PostingAttemptView = { attempt: number; outcome: "posted" | "unchanged" | "failed" | "rejected"; record_id: string | null;
  version: number | null; error: string | null; created_at: string };
export type PostedRecordView = { version: number; supersedes: number | null; cleared: Cleared };
export type PostingSummary = { tone: "positive" | "warning" | "negative"; title: string; detail: string; canRetry: boolean };

const clearedBy = (c: Cleared) => (c.by === "analyst" ? `approved by ${c.analyst}${c.reason ? `: “${c.reason}”` : ""}` : `auto-posted under ${c.policy}`);

// What the Run page says about step 8. Retry is offered only after an outage: a rejection by the system will not pass
// on a retry, and a posted run has nothing left to do.
export function postingSummary(status: string, attempts: PostingAttemptView[], record: PostedRecordView | null): PostingSummary | null {
  const last = attempts.at(-1);
  if (status === "posted" && record) {
    const version = `Record version ${record.version}${record.supersedes ? ` (supersedes version ${record.supersedes})` : ""}`;
    const unchanged = last?.outcome === "unchanged" ? " · identical to the current version, nothing new stored" : "";
    return { tone: "positive", title: "Posted to the portfolio system", detail: `${version}${unchanged} · ${clearedBy(record.cleared)}`, canRetry: false };
  }
  if (!last) return null;
  if (last.outcome === "rejected") {
    return { tone: "negative", title: "The portfolio system rejected the record", detail: `${last.error ?? "No reason given"}.`, canRetry: false };
  }
  if (last.outcome === "failed") {
    return { tone: "warning", title: "Posting failed", detail: `${last.error ?? "The portfolio system did not answer"}. The run is still cleared: retry when the system is back.`, canRetry: true };
  }
  return null;
}
