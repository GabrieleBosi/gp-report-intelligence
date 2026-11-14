import { routeBanner, type AssessmentView } from "../../core/pipeline/run-view.ts";

const BANNER_STYLE = {
  positive: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  neutral: "border-violet-200 bg-violet-50 text-violet-900",
};
const LEVEL_STYLE = {
  high: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  medium: "bg-amber-50 text-amber-800 ring-amber-200",
  low: "bg-red-50 text-red-800 ring-red-200",
};
const READS = {
  agree: { mark: "✓", label: "reads agree", style: "text-emerald-700" },
  disagree: { mark: "✗", label: "reads disagree", style: "text-red-700 font-semibold" },
  correlated: { mark: "≈", label: "both from images (not independent)", style: "text-amber-700" },
  unavailable: { mark: "–", label: "read B did not find it", style: "text-slate-400" },
};
const CHECKS = {
  pass: { text: "pass", style: "text-emerald-700" },
  fail: { text: "fail", style: "text-red-700 font-semibold" },
  none: { text: "none", style: "text-slate-400" },
};

export function ConfidencePanel({ assessment }: { assessment: AssessmentView }) {
  const banner = routeBanner(assessment);
  return (
    <section aria-labelledby="confidence-heading" className="space-y-4">
      <div role="status" className={`rounded-lg border px-4 py-3 ${BANNER_STYLE[banner.tone]}`}>
        <h3 id="confidence-heading" className="text-sm font-semibold">{banner.title}</h3>
        <p className="text-sm">{banner.detail}</p>
        {assessment.route !== "auto_post" && assessment.route !== "triage" && assessment.reasons.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
            {assessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">
            Confidence per key figure: read A from the text, independent read B from the page image, financial checks, level and reason
          </caption>
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">Key figure</th>
              <th scope="col" className="px-3 py-2 text-right">Read A <span className="normal-case">(text)</span></th>
              <th scope="col" className="px-3 py-2 text-right">Read B <span className="normal-case">(image)</span></th>
              <th scope="col" className="px-3 py-2 text-center">Reads</th>
              <th scope="col" className="px-3 py-2 text-center">Checks</th>
              <th scope="col" className="px-3 py-2">Level</th>
              <th scope="col" className="px-4 py-2">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {assessment.fields.map((f) => {
              const reads = READS[f.reads];
              return (
                <tr key={f.path} className={f.level === "low" ? "bg-red-50/40" : undefined}>
                  <th scope="row" className="px-4 py-2 text-left font-medium text-slate-800">{f.label}</th>
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-700">{f.rawA ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-700">{f.rawB ?? "—"}</td>
                  <td className={`px-3 py-2 text-center ${reads.style}`} title={reads.label}>
                    <span aria-hidden="true">{reads.mark}</span><span className="sr-only">{reads.label}</span>
                  </td>
                  <td className={`px-3 py-2 text-center text-xs ${CHECKS[f.checks].style}`}>{CHECKS[f.checks].text}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${LEVEL_STYLE[f.level]}`}>{f.level}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">{f.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
