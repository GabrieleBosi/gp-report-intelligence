import { describe, expect, it } from "vitest";
import { buildQueue, type QueueRow } from "../../../core/review/queue.ts";

const row = (over: Partial<QueueRow>): QueueRow => ({
  run_id: "r", document_id: "d", filename: "f.pdf", status: "needs_review", created_at: "2026-10-11T10:00:00Z",
  fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", reasons: ["TVPI: the report itself may be inconsistent."], ...over,
});

describe("buildQueue", () => {
  it("keeps only the latest run of each document, and only runs waiting for a human", () => {
    const queue = buildQueue([
      row({ run_id: "old", document_id: "d1", created_at: "2026-10-11T08:00:00Z", status: "needs_review" }),
      row({ run_id: "new", document_id: "d1", created_at: "2026-10-11T09:00:00Z", status: "approved" }), // already decided
      row({ run_id: "t", document_id: "d2", status: "needs_triage", fund_name: null }),
      row({ run_id: "p", document_id: "d3", status: "ready_to_post" }),
    ]);

    expect(queue.items.map((i) => i.run_id)).toEqual(["t"]);
    expect(queue.counts).toEqual({ needs_review: 0, needs_triage: 1 });
  });

  it("orders the oldest first and summarises the reasons", () => {
    const queue = buildQueue([
      row({ run_id: "b", document_id: "d2", created_at: "2026-10-11T09:00:00Z", reasons: ["A.", "B.", "C."] }),
      row({ run_id: "a", document_id: "d1", created_at: "2026-10-11T08:00:00Z" }),
    ]);

    expect(queue.items.map((i) => [i.run_id, i.summary])).toEqual([
      ["a", "TVPI: the report itself may be inconsistent."],
      ["b", "A. (+2 more)"],
    ]);
    expect(queue.counts).toEqual({ needs_review: 2, needs_triage: 0 });
  });
});
