import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { PIPELINE_STEPS, SKETCH_STEP, type StepName } from "../../core/pipeline/run.ts";
import type { RunView } from "../../core/pipeline/run-view.ts";
import { ConfidencePanel } from "../components/confidence-panel.tsx";
import { ExtractionPanel } from "../components/extraction-panel.tsx";
import { PostingPanel } from "../components/posting-panel.tsx";
import { ReviewPanel } from "../components/review-panel.tsx";
import { fetchRun, pollDelayMs } from "../lib/api.ts";

const STEP_INFO: Record<StepName, { title: string; description: string; who: string }> = {
  load: { title: "Load", description: "Fetch the stored file and verify it is byte-identical to what was received", who: "System" },
  parse: { title: "Parse", description: "Text per page from the PDF text layer; scanned pages are flagged for OCR", who: "System" },
  classify: { title: "Classify", description: "Identify GP, fund, period and currency; match against known funds", who: "AI" },
  extract: { title: "Extract", description: "Read each section into the schema, exactly as printed, with page references", who: "AI" },
  normalize: { title: "Normalize + check", description: "Units, signs and number formats to values; financial identity checks", who: "System" },
  critic: { title: "Critic", description: "Re-read the source for fields in failed checks (at most 2 rounds)", who: "AI" },
  confidence: { title: "Confidence", description: "Independent image read of the key figures; checks + agreement decide the route", who: "AI + System" },
};

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; view: RunView };

export function RunPage() {
  const { runId = "" } = useParams();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reload, setReload] = useState(0); // bumped after each review decision

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const view = await fetchRun(runId, controller.signal);
        setState({ status: "ready", view });
        const delay = pollDelayMs(view.run.status);
        if (delay !== null) timer = setTimeout(poll, delay);
      } catch (error) {
        if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, reload]);

  return (
    <section aria-labelledby="run-heading" className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <Link to="/" className="hover:text-slate-800 hover:underline">Documents</Link> <span aria-hidden="true">/</span> Run
      </nav>
      {state.status === "loading" && <p role="status" className="text-sm text-slate-500">Loading run…</p>}
      {state.status === "error" && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{state.message}</p>
      )}
      {state.status === "ready" && <RunDetails view={state.view} onChanged={() => setReload((n) => n + 1)} />}
    </section>
  );
}

function RunDetails({ view, onChanged }: { view: RunView; onChanged: () => void }) {
  const { run, document, steps } = view;
  const totalCost = steps.reduce((sum, s) => sum + (typeof s.details.costUsd === "number" ? s.details.costUsd : 0), 0);
  const terminal = pollDelayMs(run.status) === null;
  const waiting = run.status === "needs_review" || run.status === "needs_triage";
  const decided = run.status === "approved" || run.status === "rejected" || (run.status === "posted" && view.decisions.length > 0);
  const seconds = run.started_at && run.finished_at
    ? ((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000).toFixed(1) : null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="run-heading" className="text-base font-semibold text-slate-900">{document.filename}</h2>
          <p className="text-sm text-slate-500">
            {run.pipeline_version}{seconds && ` · finished in ${seconds} s`}{totalCost > 0 && ` · LLM cost $${totalCost.toFixed(4)}`}
          </p>
        </div>
        <div aria-live="polite"><StatusBadge status={run.status} /></div>
      </div>

      {run.error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-medium">Run failed.</span> {run.error}
        </p>
      )}

      <PostingPanel view={view} onChanged={onChanged} />
      {/* Waiting for a decision: act first, the evidence follows. Decided: the evidence first, the decision log after it. */}
      {waiting && view.extraction && <ReviewPanel view={view} onChanged={onChanged} />}
      {decided && view.assessment && (
        <p className="text-xs text-slate-500">Step 7 evidence, kept as recorded: why the pipeline routed this run. The decision that followed is above.</p>
      )}
      {view.assessment && <ConfidencePanel assessment={view.assessment} />}
      {!waiting && view.decisions.length > 0 && view.extraction && <ReviewPanel view={view} onChanged={onChanged} />}
      {view.extraction && <ExtractionPanel view={view.extraction} />}

      <h3 className="text-sm font-semibold text-slate-900">Pipeline steps</h3>
      <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {PIPELINE_STEPS.map((name, index) => {
          const step = steps.find((s) => s.name === name);
          const firstOpen = PIPELINE_STEPS.findIndex((n) => !steps.some((s) => s.name === n));
          const state = step ? step.outcome
            : terminal ? "absent"
            : run.status === "running" && index === firstOpen ? "running" : "pending";
          return <StepRow key={name} name={name} state={state} durationMs={step?.durationMs ?? null}
            details={step?.details ?? {}} version={run.pipeline_version} />;
        })}
      </ol>
    </>
  );
}

type StepState = "completed" | "failed" | "running" | "pending" | "absent";

function StepRow({ name, state, durationMs, details, version }: {
  name: StepName; state: StepState; durationMs: number | null; details: Record<string, unknown>; version: string;
}) {
  const info = STEP_INFO[name];
  const { costUsd, cached, ...shown } = details;
  const cost = cached === true ? "cached · $0" : typeof costUsd === "number" ? `$${costUsd.toFixed(4)}` : null;
  const icon = { completed: "✓", failed: "✕", running: "…", pending: "", absent: "–" }[state];
  const iconStyle = {
    completed: "bg-emerald-100 text-emerald-800 ring-emerald-200", failed: "bg-red-100 text-red-800 ring-red-200",
    running: "bg-blue-100 text-blue-800 ring-blue-200 animate-pulse", pending: "bg-white text-slate-400 ring-slate-200",
    absent: "bg-slate-50 text-slate-400 ring-slate-200",
  }[state];
  const stateLabel = {
    completed: "completed", failed: "failed", running: "in progress", pending: "waiting", absent: `not in ${version}`,
  }[state];

  return (
    <li className={`flex gap-4 px-4 py-3 ${state === "absent" ? "opacity-60" : ""}`}>
      <span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ${iconStyle}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-slate-900">
            Step {SKETCH_STEP[name]} · {info.title} <span className="ml-1 text-xs font-normal text-slate-500">{info.who}</span>
            <span className="sr-only">: {stateLabel}</span>
          </p>
          <p className="text-xs tabular-nums text-slate-500">
            {cost && <span className="mr-2">{cost}</span>}
            {durationMs !== null ? `${(durationMs / 1000).toFixed(2)} s` : state === "absent" ? stateLabel : ""}
          </p>
        </div>
        <p className="text-xs text-slate-500">{info.description}</p>
        {Object.keys(shown).length > 0 && (
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {Object.entries(shown).map(([key, value]) => (
              <div key={key} className="flex gap-1">
                <dt className="text-slate-500">{key}</dt>
                <dd className={key === "error" ? "font-medium text-red-700" : "text-slate-800"}>{formatDetail(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}

function formatDetail(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(", ");
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function StatusBadge({ status }: { status: RunView["run"]["status"] }) {
  const style: Record<string, string> = {
    queued: "bg-slate-100 text-slate-700 ring-slate-200", running: "bg-blue-50 text-blue-700 ring-blue-200",
    extracted: "bg-emerald-50 text-emerald-700 ring-emerald-200", failed: "bg-red-50 text-red-700 ring-red-200",
    ready_to_post: "bg-emerald-50 text-emerald-800 ring-emerald-300", needs_review: "bg-amber-50 text-amber-800 ring-amber-300",
    needs_triage: "bg-violet-50 text-violet-800 ring-violet-300", approved: "bg-emerald-100 text-emerald-900 ring-emerald-400",
    rejected: "bg-red-50 text-red-800 ring-red-300", posted: "bg-emerald-700 text-white ring-emerald-800",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${style[status] ?? "bg-slate-100 text-slate-700 ring-slate-200"}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
