import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { hrefFor, IMPROVEMENT_LOOP, labelFor, SKETCH_STEPS, type Actor, type Evidence, type SketchStep } from "../showcase/content.ts";

export const ACTORS: Record<Actor, { label: string; chip: string }> = {
  system: { label: "System", chip: "bg-slate-100 text-slate-800 ring-slate-300" },
  ai: { label: "AI", chip: "bg-violet-50 text-violet-900 ring-violet-300" },
  analyst: { label: "Analyst", chip: "bg-amber-50 text-amber-900 ring-amber-300" },
};

type Item = { key: string; badge: string | null; step: Omit<SketchStep, "n">; branch?: string };
const ITEMS: Item[] = [
  ...SKETCH_STEPS.map((step): Item => ({
    key: `step-${step.n}`, badge: String(step.n), step,
    branch: step.n === 7 ? "yes → 8 · no → 9" : step.n === 9 ? "approve → 8 · new GP → triage" : undefined,
  })),
  { key: "loop", badge: null, step: IMPROVEMENT_LOOP, branch: "around every step" },
];

const EVIDENCE_GROUPS: { kind: Evidence["kind"]; title: string }[] = [
  { kind: "doc", title: "Specification and decisions" }, { kind: "test", title: "Tests" }, { kind: "run", title: "Recorded runs" },
];

const LoopIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 8a5 5 0 1 1-1.5-3.5" /><path d="M13 2.5v3h-3" />
  </svg>
);

// The process sketch as a tab list (WAI-ARIA tabs): arrow keys, Home and End move between steps.
export function SketchDiagram() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const item = ITEMS[selected];
  if (!item) return null;

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const last = ITEMS.length - 1;
    const next = { ArrowRight: i === last ? 0 : i + 1, ArrowDown: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1,
      ArrowUp: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Steps of the process sketch" aria-orientation="horizontal" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {ITEMS.map((it, i) => (
          <button key={it.key} id={`tab-${it.key}`} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab"
            aria-selected={i === selected} aria-controls="sketch-panel" tabIndex={i === selected ? 0 : -1}
            onClick={() => setSelected(i)} onKeyDown={(e) => onKeyDown(e, i)}
            className={`flex flex-col items-start gap-1 rounded-lg border bg-white px-3 py-2 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
              i === selected ? "border-slate-900 shadow-sm ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-400"}`}>
            <span className="flex w-full items-center justify-between gap-2">
              <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{it.badge ?? <LoopIcon />}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${ACTORS[it.step.actor].chip}`}>{ACTORS[it.step.actor].label}</span>
            </span>
            <span className="font-medium leading-snug text-slate-900">{it.key === "loop" ? "Improvement loop" : it.step.title}</span>
            {it.branch && <span className="text-xs text-slate-500">{it.branch}</span>}
          </button>
        ))}
      </div>

      <div id="sketch-panel" role="tabpanel" aria-labelledby={`tab-${item.key}`} tabIndex={0}
        className="rounded-lg border border-slate-200 bg-white px-5 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900">
        <h3 className="text-base font-semibold text-slate-900">
          {item.badge ? `${item.badge}. ` : ""}{item.step.title}
          <span className={`ml-2 align-middle rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${ACTORS[item.step.actor].chip}`}>{ACTORS[item.step.actor].label}</span>
        </h3>
        <dl className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <div><dt className="font-medium text-slate-500">What it does</dt><dd className="mt-1 text-slate-800">{item.step.does}</dd></div>
          <div><dt className="font-medium text-slate-500">Business requirement</dt><dd className="mt-1 text-slate-800">{item.step.requirement}</dd></div>
          <div><dt className="font-medium text-slate-500">Technical choice</dt><dd className="mt-1 text-slate-800">{item.step.choice}</dd></div>
        </dl>
        <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 text-sm md:grid-cols-3">
          {EVIDENCE_GROUPS.map((g) => (
            <div key={g.kind}>
              <h4 className="font-medium text-slate-500">{g.title}</h4>
              <ul className="mt-1 space-y-1">
                {item.step.evidence.filter((e) => e.kind === g.kind).map((e) => (
                  <li key={hrefFor(e)}><Link to={hrefFor(e)} className="break-words text-slate-800 underline underline-offset-2 hover:text-slate-600">{labelFor(e)}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
