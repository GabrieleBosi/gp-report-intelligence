import { Link } from "react-router";
import { hrefFor, labelFor, TOURS } from "../showcase/content.ts";

const minutes = (m: number) => (m < 1 ? `${m * 60} s` : `${m} min`);
const total = TOURS.reduce((sum, t) => sum + t.steps.reduce((s, x) => s + x.minutes, 0), 0);

// Showcase demo tour (SPEC-showcase, page 2): three guided scenarios through the app, for a 10-minute walkthrough.
export function TourPage() {
  return (
    <section aria-labelledby="tour-heading" className="space-y-5">
      <div className="max-w-5xl space-y-1">
        <h2 id="tour-heading" className="text-xl font-semibold text-slate-900">Demo tour</h2>
        <p className="text-slate-700">
          Three scenarios through the app, each a few clicks. About {Math.round(total)} minutes in total. The runs linked
          here are recorded runs of the real pipeline; the posted ones are final, so the links always show the same result.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {TOURS.map((tour, i) => (
          <article key={tour.id} aria-labelledby={`tour-${tour.id}`} className="flex flex-col rounded-lg border border-slate-200 bg-white p-4">
            <h3 id={`tour-${tour.id}`} className="font-semibold text-slate-900">{String.fromCharCode(65 + i)}. {tour.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{tour.point}</p>
            <ol className="mt-3 space-y-2">
              {tour.steps.map((step, n) => (
                <li key={`${tour.id}-${n}`}>
                  <Link to={hrefFor(step.link)} className="group flex gap-3 rounded-md border border-slate-100 p-2 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900">
                    <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{n + 1}</span>
                    <span className="min-w-0 text-sm">
                      <span className="block text-slate-800">{step.text}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        <span className="underline underline-offset-2 group-hover:text-slate-700">{labelFor(step.link)}</span> · {minutes(step.minutes)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
