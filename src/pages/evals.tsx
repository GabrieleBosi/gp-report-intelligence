import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Metrics } from "../../core/showcase/metrics.ts";
import { isLive } from "../lib/access.ts";
import { fetchMetrics } from "../lib/api.ts";
import { HELDOUT_NOTES, hrefFor, labelFor, LOOP_TIMELINE, type Evidence } from "../showcase/content.ts";
import { errorList, gateRows, heldoutHistory, latestReport, shadowRows } from "../showcase/evals.ts";
import { BASELINE, HELDOUT_FILES, REPORT_FILES, SHADOW_FILES } from "../showcase/sources.ts";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const usd = (v: number) => `$${v.toFixed(3)}`;
const report = latestReport(REPORT_FILES);
const gate = BASELINE ? gateRows(BASELINE, report.summary) : [];
const errors = errorList(report);
const heldout = heldoutHistory(HELDOUT_FILES);
const shadow = shadowRows(SHADOW_FILES);

const EvidenceLink = ({ e }: { e: Evidence }) => (
  <Link to={hrefFor(e)} className="underline underline-offset-2 hover:text-slate-600">{labelFor(e)}</Link>
);
const Badge = ({ ok, children }: { ok: boolean; children: ReactNode }) => (
  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${ok ? "bg-emerald-50 text-emerald-800 ring-emerald-300" : "bg-red-50 text-red-800 ring-red-300"}`}>{children}</span>
);
const card = "rounded-lg border border-slate-200 bg-white p-4";
const th = "px-3 py-2 font-medium";
const td = "px-3 py-2";

// Showcase evals page (SPEC-showcase, page 5): the improvement loop's numbers, every one dated, from committed reports.
export function EvalsPage() {
  return (
    <section aria-labelledby="evals-heading" className="space-y-5">
      <div className="max-w-5xl space-y-1">
        <h2 id="evals-heading" className="text-xl font-semibold text-slate-900">Evals</h2>
        <p className="text-slate-700">
          Every change to a prompt, model, rule or policy is measured on a labelled golden set before it ships, graded by code
          (no model judges a model). Zero unsafe auto-posts is absolute; the other gated metrics may never fall below the
          committed baseline. The golden set is small and says so: 12 dev documents, 6 held out.
        </p>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-slate-900">The gate, on every push <Badge ok={report.gate.pass}>{report.gate.pass ? "pass" : "fail"}</Badge></h3>
          <p className="text-xs text-slate-500">{report.version} · {report.summary.documents} dev documents · {report.generated_at} · recorded answers replayed, $0</p>
        </div>
        <div className="relative mt-2 overflow-x-auto">
          <table className="min-w-full text-sm" aria-label="Gated metrics, latest report against the baseline">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th scope="col" className={th}>Metric</th><th scope="col" className={`${th} text-right`}>Baseline</th><th scope="col" className={`${th} text-right`}>Latest</th><th scope="col" className={th}>Rule</th><th scope="col" className={th}><span className="sr-only">Result</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {gate.map((r) => (
                <tr key={r.metric}>
                  <td className={td}>{r.metric}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.percent ? pct(r.baseline) : r.baseline}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.percent ? pct(r.latest) : r.latest}</td>
                  <td className={`${td} text-slate-500`}>{r.rule}</td>
                  <td className={td}><Badge ok={r.ok}>{r.ok ? "ok" : "fails"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Proof that the gate bites: a deliberately broken change failed CI, the revert passed ({<EvidenceLink e={{ kind: "doc", file: "docs/evals/gate-proof.md", label: "gate proof" }} />}).
        </p>
      </div>

      <LiveNumbers />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className={card}>
          <h3 className="font-semibold text-slate-900">Errors by first bad step</h3>
          <p className="text-xs text-slate-500">{report.version} · {report.generated_at} · the earliest step whose output already disagrees with the label, so the cheapest fix is visible</p>
          <ul className="mt-2 space-y-1 text-sm">
            {errors.map((e) => (
              <li key={`${e.doc_id}-${e.path}`} className="flex gap-2">
                <span className="w-28 shrink-0 text-slate-500">{e.stepName}</span>
                <span className="min-w-0 text-slate-800">{e.key && e.path !== "route" && <Badge ok={false}>key figure</Badge>} {e.doc_id}: {e.label}{e.expected !== null && e.actual !== null ? ` (${e.actual.toLocaleString("en-GB")} instead of ${e.expected.toLocaleString("en-GB")})` : ""}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-slate-900">Held-out: measured, never tuned on</h3>
          <p className="text-xs text-slate-500">Run on the live site after a change, reported as stored</p>
          <ul className="mt-2 space-y-3 text-sm">
            {heldout.map((h) => (
              <li key={h.file}>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{h.pipeline}</span>
                  <span className="text-xs text-slate-500">{h.date}</span>
                  <span className="tabular-nums text-slate-800">{h.routesOk} of {h.documents} routes as labelled</span>
                  <Badge ok={h.unsafe === 0}>{h.unsafe} unsafe</Badge>
                </p>
                <p className="mt-0.5 text-xs text-slate-600">{HELDOUT_NOTES[h.pipeline] ?? ""}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-slate-900">Shadow: a cheaper model, one step at a time</h3>
        <p className="text-xs text-slate-500">2026-10-11 · Sonnet 5.5 against Opus 5.5 on the 12 dev documents · <EvidenceLink e={{ kind: "doc", file: "evals/shadow/2026-10-11-summary.md", label: "summary and recommendation" }} /></p>
        <div className="relative mt-2 overflow-x-auto">
          <table className="min-w-full text-sm" aria-label="Shadow experiments">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th scope="col" className={th}>Step</th><th scope="col" className={th}>Verdict</th><th scope="col" className={`${th} text-right`}>Unsafe</th><th scope="col" className={`${th} text-right`}>Key figures</th><th scope="col" className={`${th} text-right`}>Routes</th><th scope="col" className={`${th} text-right`}>Step cost, Opus → Sonnet</th></tr></thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {shadow.map((s) => (
                <tr key={s.step}>
                  <td className={td}>{s.step === "confidence" ? "read B" : s.step}</td>
                  <td className={td}>{s.verdict}</td>
                  <td className={`${td} text-right`}>{s.unsafe[0]} → {s.unsafe[1]}</td>
                  <td className={`${td} text-right`}>{pct(s.keyFigureAccuracy[0])} → {pct(s.keyFigureAccuracy[1])}</td>
                  <td className={`${td} text-right`}>{pct(s.routeAccuracy[0])} → {pct(s.routeAccuracy[1])}</td>
                  <td className={`${td} text-right`}>{usd(s.stepCost[0])} → {usd(s.stepCost[1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Eligible on the dev split is not the end of it: the held-out measurement after the switch is the real test. Below is what happened.</p>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-slate-900">The improvement loop, 11 October 2026</h3>
        <p className="text-xs text-slate-500">Times CEST, from the development history and the run log</p>
        <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">
          {LOOP_TIMELINE.map((t) => (
            <li key={t.phase} className="relative text-sm">
              <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-900" />
              <p><span className="font-medium text-slate-900">{t.time} · {t.phase}</span></p>
              <p className="text-slate-700">{t.text}</p>
              <p className="text-xs text-slate-600">{t.evidence.map((e, i) => <span key={hrefFor(e)}>{i > 0 && " · "}<EvidenceLink e={e} /></span>)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const parts = (counts: Record<string, number>, labels: Record<string, string> = {}) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${labels[k] ?? k.replace(/_/g, " ")}`).join(" · ");

const spendByStep = (byStep: Record<string, number>) => Object.entries(byStep).filter(([, usd]) => usd >= 0.005).sort((a, b) => b[1] - a[1])
  .map(([step, usd]) => `${step === "confidence" ? "read B" : step} $${usd.toFixed(2)}`).join(" · ");

// Operating numbers (GET /api/metrics, or the snapshot's copy: counts only). Activity on this site, not accuracy: that is
// the gate above.
function LiveNumbers() {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; m: Metrics }>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetchMetrics(controller.signal).then((m) => setState({ status: "ready", m }))
      .catch((e: unknown) => { if (!controller.signal.aborted) setState({ status: "error", message: e instanceof Error ? e.message : String(e) }); });
    return () => controller.abort();
  }, []);

  return (
    <section aria-labelledby="live-heading" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="live-heading" className="font-semibold text-slate-900">{isLive() ? "Live on this site" : "Recorded on this site"}</h3>
        {state.status === "ready" && <p className="text-xs text-slate-500">As of {new Date(state.m.generated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" })} (Zurich) · counts only</p>}
      </div>
      {state.status === "loading" && <p role="status" className="mt-2 text-sm text-slate-500">Loading the numbers…</p>}
      {state.status === "error" && <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{state.message}</p>}
      {state.status === "ready" && (
        <>
          <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <Tile label="Documents" value={state.m.documents.total} detail={`${state.m.documents.corpus} synthetic corpus, ${plural(state.m.documents.upload, "upload")}`} />
            <Tile label="Pipeline runs" value={state.m.runs.total}
              detail={`routed: ${state.m.routes.auto_post} auto-post · ${state.m.routes.review} review · ${state.m.routes.triage} triage`} />
            <Tile label="Analyst decisions" value={state.m.review.decisions}
              detail={parts(state.m.review.byKind, { field_accepted: "figures accepted", field_corrected: "corrections", approved: "approvals" })} />
            <Tile label="Portfolio records" value={state.m.portfolio.records}
              detail={`${state.m.portfolio.versions} versions; ${state.m.postings.attempts} posting attempts: ${parts(state.m.postings.byOutcome)}`} />
            <Tile label="LLM spend" value={`$${state.m.llm.costUsd.toFixed(2)}`} detail={`${state.m.llm.calls} model calls: ${spendByStep(state.m.llm.byStep)}`} />
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Everything that ran here since the start, demo runs and repeated end-to-end tests included (they are why some records
            have many versions). These numbers show activity; accuracy is what the gate above measures.
          </p>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums text-slate-900">{value}</dd>
      <dd className="text-xs text-slate-600">{detail}</dd>
    </div>
  );
}
