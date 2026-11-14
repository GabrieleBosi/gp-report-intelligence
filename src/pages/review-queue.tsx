import { useEffect, useState } from "react";
import { Link } from "react-router";
import { fetchReviewQueue, type ReviewQueue } from "../lib/api.ts";
import { quarterLabel } from "../lib/format.ts";

// Sketch step 9's inbox: every run waiting for a human, oldest first (SPEC-review flow 1).
export function ReviewQueuePage() {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; queue: ReviewQueue }>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetchReviewQueue(controller.signal).then((queue) => setState({ status: "ready", queue }))
      .catch((e: unknown) => { if (!controller.signal.aborted) setState({ status: "error", message: e instanceof Error ? e.message : String(e) }); });
    return () => controller.abort();
  }, []);

  return (
    <section aria-labelledby="queue-heading" className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 id="queue-heading" className="text-base font-semibold text-slate-900">Review queue</h2>
        {state.status === "ready" && (
          <p className="text-sm text-slate-500">{state.queue.counts.needs_review} to review · {state.queue.counts.needs_triage} to triage</p>
        )}
      </div>
      {state.status === "loading" && <p role="status" className="text-sm text-slate-500">Loading the queue…</p>}
      {state.status === "error" && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{state.message}</p>}
      {state.status === "ready" && state.queue.items.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">Nothing waits for a human. Every run was posted automatically or decided.</p>
      )}
      {state.status === "ready" && state.queue.items.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {state.queue.items.map((item) => (
            <li key={item.run_id}>
              <Link to={`/runs/${item.run_id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${item.status === "needs_triage" ? "bg-violet-50 text-violet-800 ring-violet-300" : "bg-amber-50 text-amber-800 ring-amber-300"}`}>
                  {item.status === "needs_triage" ? "triage" : "review"}
                </span>
                <span className="min-w-56 font-medium text-slate-900">{item.filename}</span>
                <span className="text-sm text-slate-600">{item.fund_name ?? "Unknown GP"}{item.period_end && ` · ${quarterLabel(item.period_end)}`}</span>
                <span className="w-full text-sm text-slate-500">{item.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
