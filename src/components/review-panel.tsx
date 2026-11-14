import { useEffect, useId, useState } from "react";
import type { RunView } from "../../core/pipeline/run-view.ts";
import { savedAnalyst, saveAnalyst } from "../lib/analyst.ts";
import { fetchFunds, submitReview } from "../lib/api.ts";
import { approvalBlockers, checkRows, pageOf, printedAt, reviewChecklist, type ChecklistRow } from "../lib/review.ts";
import { SourcePage } from "./source-page.tsx";

type Action = Parameters<typeof submitReview>[1]["action"];
const LEVEL = { high: "bg-emerald-50 text-emerald-800 ring-emerald-200", medium: "bg-amber-50 text-amber-800 ring-amber-200", low: "bg-red-50 text-red-800 ring-red-200" };
const STATE = { pending: "needs a decision", accepted: "accepted as printed", corrected: "corrected", ok: "high: no action needed" };
const button = "rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

// Sketch step 9: the analyst decides with the source page beside the evidence (SPEC-review).
export function ReviewPanel({ view, onChanged }: { view: RunView; onChanged: () => void }) {
  const { run, document, assessment, extraction, decisions } = view;
  const waiting = run.status === "needs_review" || run.status === "needs_triage";
  const parse = view.steps.find((s) => s.name === "parse")?.details ?? {};
  const workbook = parse.kind === "xlsx";
  const pageCount = typeof parse.pages === "number" ? parse.pages : 1;
  const [page, setPage] = useState(1);
  const [analyst, setAnalyst] = useState(savedAnalyst());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const nameId = useId();

  async function act(action: Action) {
    if (!analyst.trim()) { setMessage("Enter your name first: it is recorded with every decision."); return; }
    saveAnalyst(analyst);
    setBusy(true); setMessage(null);
    const result = await submitReview(run.id, { analyst, seen_status: run.status, action });
    setBusy(false);
    if (result.ok) onChanged(); else setMessage(result.message);
  }

  const rows = assessment ? reviewChecklist(assessment, decisions) : [];
  const failed = (extraction?.checks ?? []).filter((c) => c.status === "fail").map((c) => c.id);
  const blockers = approvalBlockers(rows, failed);

  return (
    <section aria-labelledby="review-heading" className="space-y-4 rounded-lg border border-slate-300 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="review-heading" className="text-sm font-semibold text-slate-900">
          {run.status === "needs_triage" ? "Triage" : "Review"} <span className="font-normal text-slate-500">· sketch step 9</span>
        </h3>
        {waiting && (
          <label htmlFor={nameId} className="flex items-center gap-2 text-sm text-slate-600">
            Your name
            <input id={nameId} value={analyst} onChange={(e) => setAnalyst(e.target.value)} maxLength={80} autoComplete="name"
              className="w-44 rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <span className="text-xs text-slate-400">(self-declared, recorded with each decision)</span>
          </label>
        )}
      </div>
      {message && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <SourcePage runId={run.id} filename={document.filename} pageCount={pageCount} page={page} onPageChange={setPage} workbook={workbook} />
        </div>
        <div className="space-y-4">
          {run.status === "needs_review" && rows.length > 0 && (
            <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Key figures to check">
              {rows.map((row) => (
                <FigureRow key={row.path} row={row} busy={busy} pageCount={pageCount}
                  page={extraction ? pageOf(extraction.raw, row.path) : null}
                  onShow={(p) => setPage(p)} onAccept={() => act({ kind: "accept_field", field: row.path })}
                  onCorrect={(raw, p) => act({ kind: "correct", field: row.path, raw, page: p })} />
              ))}
            </ol>
          )}
          {run.status === "needs_review" && extraction && (() => {
            const other = checkRows(extraction.checks, assessment, extraction.raw.portfolio.companies, decisions);
            return other.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Other figures in failed checks</h4>
                <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Other figures in failed checks">
                  {other.map((row) => {
                    const printed = printedAt(extraction.raw, row.path);
                    return (
                      <FigureRow key={row.path} pageCount={pageCount} busy={busy} page={printed.page} onShow={(p) => setPage(p)}
                        row={{ path: row.path, label: row.label, rawA: printed.raw, reason: row.reason, level: "low", state: row.corrected ? "corrected" : "pending",
                          valueA: null, valueB: null, rawB: null, checks: "fail", reads: "unavailable", flags: [] }}
                        correctOnly onAccept={() => {}} onCorrect={(raw, p) => act({ kind: "correct", field: row.path, raw, page: p })} />
                    );
                  })}
                </ol>
              </div>
            );
          })()}
          {run.status === "needs_review" && <Decide busy={busy} blockers={blockers} failed={failed} act={act} />}
          {run.status === "needs_triage" && <Triage busy={busy} act={act} reasons={assessment?.reasons ?? []} />}
          <DecisionLog view={view} />
        </div>
      </div>
    </section>
  );
}

function FigureRow({ row, page, pageCount, busy, onShow, onAccept, onCorrect, correctOnly = false }: {
  row: ChecklistRow; page: number | null; pageCount: number; busy: boolean; correctOnly?: boolean;
  onShow: (page: number) => void; onAccept: () => void; onCorrect: (raw: string, page: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(row.rawA ?? "");
  const [atPage, setAtPage] = useState(page ?? 1);
  const rawId = useId();
  const pageId = useId();
  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {row.label} <span className="font-mono text-xs text-slate-600">{row.rawA ?? "—"}</span>
            {page && <button type="button" onClick={() => onShow(page)} className="ml-2 text-xs text-blue-700 underline">page {page}</button>}
          </p>
          <p className="text-xs text-slate-500">{row.reason}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${LEVEL[row.level]}`}>{row.level}</span>
          <span className="text-xs text-slate-500">{STATE[row.state]}</span>
          {row.state !== "ok" && (
            <>
              {!correctOnly && <button type="button" disabled={busy} onClick={onAccept} aria-label={`Accept ${row.label}`} className={`${button} bg-slate-100 text-slate-800 hover:bg-slate-200`}>Accept</button>}
              <button type="button" disabled={busy} onClick={() => setEditing(!editing)} aria-expanded={editing} aria-label={`Correct ${row.label}`} className={`${button} bg-slate-100 text-slate-800 hover:bg-slate-200`}>Correct</button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); onCorrect(raw, atPage); setEditing(false); }}>
          <label htmlFor={rawId} className="text-xs text-slate-600">Value as printed
            <input id={rawId} value={raw} onChange={(e) => setRaw(e.target.value)} required maxLength={40} className="mt-0.5 block w-36 rounded-md border border-slate-300 px-2 py-1 font-mono text-sm" />
          </label>
          <label htmlFor={pageId} className="text-xs text-slate-600">Page
            <input id={pageId} type="number" min={1} max={pageCount} value={atPage} onChange={(e) => setAtPage(Number(e.target.value))} required className="mt-0.5 block w-20 rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <button type="submit" disabled={busy} className={`${button} bg-slate-900 text-white hover:bg-slate-700`}>Save correction</button>
        </form>
      )}
    </li>
  );
}

function Decide({ busy, blockers, failed, act }: { busy: boolean; blockers: { pending: string[]; reasonRequired: boolean }; failed: string[]; act: (a: Action) => void }) {
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const canApprove = blockers.pending.length === 0 && (!blockers.reasonRequired || reason.trim().length > 0);
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <label htmlFor={reasonId} className="block text-sm font-medium text-slate-800">
        Reason {blockers.reasonRequired ? <span className="font-normal text-red-700">(required: checks still fail: {failed.join(", ")})</span>
          : <span className="font-normal text-slate-500">(required to reject)</span>}
      </label>
      <textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2}
        placeholder="e.g. Posted as printed; GP asked to restate TVPI" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
      {blockers.pending.length > 0 && <p className="text-xs text-amber-800">Accept or correct first: {blockers.pending.join(", ")}.</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !canApprove} onClick={() => act({ kind: "approve", ...(reason.trim() ? { reason } : {}) })}
          className={`${button} bg-emerald-700 text-white hover:bg-emerald-800`}>Approve for posting</button>
        <button type="button" disabled={busy || !reason.trim()} onClick={() => act({ kind: "reject", reason })}
          className={`${button} bg-red-700 text-white hover:bg-red-800`}>Reject</button>
      </div>
    </div>
  );
}

function Triage({ busy, act, reasons }: { busy: boolean; act: (a: Action) => void; reasons: string[] }) {
  const [funds, setFunds] = useState<{ id: string; gp_name: string; fund_name: string }[]>([]);
  const [fundId, setFundId] = useState("");
  const [reason, setReason] = useState("");
  const fundIdField = useId();
  const reasonId = useId();
  useEffect(() => {
    const controller = new AbortController();
    fetchFunds(controller.signal).then(setFunds).catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-sm">
      <p className="text-violet-900">{reasons.join(" ")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={fundIdField} className="text-slate-700">Assign to a fund in the registry
          <select id={fundIdField} value={fundId} onChange={(e) => setFundId(e.target.value)} className="mt-0.5 block rounded-md border border-slate-300 px-2 py-1">
            <option value="">Choose a fund…</option>
            {funds.map((f) => <option key={f.id} value={f.id}>{f.fund_name} ({f.gp_name})</option>)}
          </select>
        </label>
        <button type="button" disabled={busy || !fundId} onClick={() => act({ kind: "assign_fund", fundId })} className={`${button} bg-slate-900 text-white hover:bg-slate-700`}>Assign and review</button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={reasonId} className="text-slate-700">Or reject, with a reason
          <input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="mt-0.5 block w-72 rounded-md border border-slate-300 px-2 py-1" />
        </label>
        <button type="button" disabled={busy || !reason.trim()} onClick={() => act({ kind: "reject", reason })} className={`${button} bg-red-700 text-white hover:bg-red-800`}>Reject</button>
      </div>
    </div>
  );
}

const KIND = { field_accepted: "accepted", field_corrected: "corrected", approved: "approved", rejected: "rejected", fund_assigned: "assigned the fund" };

function DecisionLog({ view }: { view: RunView }) {
  if (view.decisions.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Decision log (append-only)</h4>
      <ol className="space-y-1 text-sm text-slate-700">
        {view.decisions.map((d, i) => (
          <li key={i}>
            <span className="font-medium">{d.analyst}</span> {KIND[d.kind]}{d.field && <> <span className="font-mono text-xs">{d.field}</span></>}
            {d.kind === "field_corrected" && <> {String(d.before?.raw)} → <span className="font-mono">{String(d.after?.raw)}</span></>}
            {d.reason && <>: “{d.reason}”</>}
            <span className="ml-1 text-xs text-slate-400">{new Date(d.created_at).toLocaleString("en-GB")} · {d.policy}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
