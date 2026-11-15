// The review queue (SPEC-review flow 1): the latest run of each document, if it waits for a human, oldest first.
export type QueueRow = {
  run_id: string; document_id: string; filename: string; status: string; created_at: string;
  fund_name: string | null; period_end: string | null; reasons: string[];
};
export type QueueItem = QueueRow & { status: "needs_review" | "needs_triage"; summary: string };
export type Queue = { items: QueueItem[]; counts: { needs_review: number; needs_triage: number } };

const WAITING = new Set(["needs_review", "needs_triage"]);

export function buildQueue(rows: QueueRow[]): Queue {
  const latest = new Map<string, QueueRow>();
  for (const r of rows) {
    const seen = latest.get(r.document_id);
    if (!seen || r.created_at > seen.created_at) latest.set(r.document_id, r);
  }
  const items = [...latest.values()]
    .filter((r): r is QueueRow & { status: QueueItem["status"] } => WAITING.has(r.status))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => ({ ...r, summary: r.reasons.length > 1 ? `${r.reasons[0]} (+${r.reasons.length - 1} more)` : (r.reasons[0] ?? "") }));
  return { items, counts: queueCounts(items) };
}

export function queueCounts(items: { status: string }[]): Record<"needs_review" | "needs_triage", number> {
  return { needs_review: items.filter((i) => i.status === "needs_review").length, needs_triage: items.filter((i) => i.status === "needs_triage").length };
}
