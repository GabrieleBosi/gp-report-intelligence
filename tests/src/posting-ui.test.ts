import { describe, expect, it } from "vitest";
import { postingSummary } from "../../src/lib/posting.ts";

const attempt = (outcome: "posted" | "unchanged" | "failed" | "rejected", error: string | null = null) =>
  ({ attempt: 1, outcome, record_id: outcome === "failed" ? null : "f:2025-09-30", version: outcome === "failed" ? null : 2, error, created_at: "2026-10-11T12:00:00Z" });

describe("postingSummary", () => {
  it("says where a posted run went and how it was cleared", () => {
    expect(postingSummary("posted", [attempt("posted")], { version: 2, supersedes: 1, cleared: { by: "analyst", analyst: "G", reason: "ok" } }))
      .toEqual({ tone: "positive", title: "Posted to the portfolio system", detail: "Record version 2 (supersedes version 1) · approved by G: “ok”", canRetry: false });
    expect(postingSummary("posted", [attempt("unchanged")], { version: 1, supersedes: null, cleared: { by: "auto_post", policy: "policy@2" } }))
      .toMatchObject({ detail: "Record version 1 · identical to the current version, nothing new stored · auto-posted under policy@2" });
  });

  it("offers a retry only after an outage, not after a rejection", () => {
    expect(postingSummary("ready_to_post", [attempt("failed", "portfolio system timed out")], null))
      .toEqual({ tone: "warning", title: "Posting failed", detail: "portfolio system timed out. The run is still cleared: retry when the system is back.", canRetry: true });
    expect(postingSummary("approved", [attempt("rejected", "unknown fund")], null))
      .toMatchObject({ tone: "negative", title: "The portfolio system rejected the record", canRetry: false });
  });

  it("says nothing for runs that are not cleared and were never posted", () => {
    expect(postingSummary("needs_review", [], null)).toBeNull();
  });
});
