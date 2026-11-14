import { Link } from "react-router";
import { ACTORS, SketchDiagram } from "../components/sketch-diagram.tsx";
import { hrefFor, labelFor, OVERVIEW } from "../showcase/content.ts";

// Showcase overview (SPEC-showcase, page 1): the case, the three convictions, and the process sketch rebuilt.
export function AboutPage() {
  return (
    <section aria-labelledby="about-heading" className="space-y-5">
      <div className="max-w-5xl space-y-2">
        <h2 id="about-heading" className="text-xl font-semibold text-slate-900">What this system does, and why it can be trusted</h2>
        <p className="text-slate-700">{OVERVIEW.case.join(" ")}</p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-900">My process sketch, rebuilt</h3>
            <p className="text-sm text-slate-500">I drew it in response to the business case above. Select a step (or use the arrow keys) to see what it does, why, and the evidence.</p>
          </div>
          <p className="flex gap-2 text-xs" aria-label="Who acts">
            {Object.values(ACTORS).map((a) => <span key={a.label} className={`rounded px-1.5 py-0.5 font-medium ring-1 ring-inset ${a.chip}`}>{a.label}</span>)}
          </p>
        </div>
        <SketchDiagram />
      </div>

      <ul className="grid gap-3 md:grid-cols-3">
        {OVERVIEW.convictions.map((c) => (
          <li key={c.title} className="flex flex-col rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="font-semibold text-slate-900">{c.title}</h3>
            <p className="mt-1 flex-1 text-sm text-slate-700">{c.text}</p>
            <Link to={hrefFor(c.link)} className="mt-3 text-sm font-medium text-slate-900 underline underline-offset-2 hover:text-slate-600">{labelFor(c.link)} →</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
