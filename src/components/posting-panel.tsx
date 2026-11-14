import { useState } from "react";
import { Link } from "react-router";
import type { RunView } from "../../core/pipeline/run-view.ts";
import { retryPosting } from "../lib/api.ts";
import { postingSummary } from "../lib/posting.ts";

const TONE = {
  positive: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  negative: "border-red-200 bg-red-50 text-red-900",
};

// Sketch step 8 on the Run page: where the figures went, on whose authority, and every attempt.
export function PostingPanel({ view, onChanged }: { view: RunView; onChanged: () => void }) {
  const summary = postingSummary(view.run.status, view.posting.attempts, view.posting.record);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!summary) return null;

  async function retry() {
    setBusy(true); setMessage(null);
    const result = await retryPosting(view.run.id);
    setBusy(false);
    if (result.ok) onChanged(); else setMessage(result.message);
  }

  return (
    <section aria-labelledby="posting-heading" className={`space-y-2 rounded-lg border px-4 py-3 ${TONE[summary.tone]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="posting-heading" className="text-sm font-semibold">{summary.title} <span className="font-normal opacity-70">· sketch step 8</span></h3>
        <Link to="/portfolio" className="text-xs underline">Portfolio system (mock)</Link>
      </div>
      <p className="text-sm">{summary.detail}</p>
      {summary.canRetry && (
        <button type="button" onClick={retry} disabled={busy}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:opacity-50">
          {busy ? "Posting…" : "Retry posting"}
        </button>
      )}
      {message && <p role="alert" className="text-sm text-red-800">{message}</p>}
      {view.posting.attempts.length > 0 && (
        <ol className="text-xs opacity-80" aria-label="Posting attempts">
          {view.posting.attempts.map((a) => (
            <li key={a.attempt}>Attempt {a.attempt}: {a.outcome}{a.version !== null && ` · version ${a.version}`}{a.error && ` · ${a.error}`} · {new Date(a.created_at).toLocaleString("en-GB")}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
