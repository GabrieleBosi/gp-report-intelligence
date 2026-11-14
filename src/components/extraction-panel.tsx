import { fundFieldRows, type ExtractionView, type FieldRow } from "../../core/pipeline/run-view.ts";
import type { Money } from "../../core/schema.ts";

const fullAmount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const millions = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatValue(row: FieldRow): string {
  if (!row.value) return "—";
  if ("currency" in row.value) return `${row.value.currency} ${fullAmount.format(row.value.value)}`;
  return row.key === "net_irr" ? `${(row.value.value * 100).toFixed(1)}%` : `${row.value.value.toFixed(2)}x`;
}

const inMillions = (m: Money | null) => (m ? millions.format(m.value / 1e6) : "—");

export function ExtractionPanel({ view }: { view: ExtractionView }) {
  const rows = fundFieldRows(view);
  const { extraction, checks } = view;
  const failed = checks.filter((c) => c.status === "fail");

  return (
    <section aria-labelledby="extraction-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="extraction-heading" className="text-sm font-semibold text-slate-900">Extracted values <span className="font-normal text-slate-500">· round {view.round}</span></h3>
        <p className="text-xs text-slate-500">
          {checks.filter((c) => c.status === "pass").length} checks passed · {failed.length} failed · {checks.filter((c) => c.status === "skipped").length} skipped
        </p>
      </div>

      {!extraction && (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No valid extraction: see the normalize step for the reason.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">Fund figures: value after normalization, text as printed, page, and failed checks</caption>
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">Fund figure</th>
              <th scope="col" className="px-4 py-2 text-right">Value</th>
              <th scope="col" className="px-4 py-2 text-right">As printed</th>
              <th scope="col" className="px-4 py-2 text-right">Page</th>
              <th scope="col" className="px-4 py-2">Checks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.key} className={row.failedChecks.length ? "bg-red-50/60" : undefined}>
                <th scope="row" className="px-4 py-2 text-left font-medium text-slate-800">{row.label}</th>
                <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatValue(row)}</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                  {row.read === "vision" && (
                    <span className="mr-2 rounded bg-violet-50 px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase text-violet-700 ring-1 ring-inset ring-violet-200"
                      title="Not in the text layer: read from the page image by the vision fallback">image</span>
                  )}
                  {row.raw ?? "not stated"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">{row.page ?? "—"}</td>
                <td className="px-4 py-2 text-xs">
                  {row.failedChecks.length
                    ? row.failedChecks.map((message) => <p key={message} className="text-red-700">{message}</p>)
                    : <span className="text-emerald-700">ok</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {extraction && extraction.portfolio_companies.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <caption className="sr-only">Portfolio companies in millions of {extraction.classification.currency}</caption>
            <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2 text-left">Company ({extraction.classification.currency} m)</th>
                {["Invested", "Realized", "Unrealized", "Total value", "Gross MOIC", "Revenue", "EBITDA", "Net debt"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {extraction.portfolio_companies.map((c) => (
                <tr key={c.name}>
                  <th scope="row" className="px-4 py-2 text-left font-medium text-slate-800">
                    {c.name}<span className="block text-xs font-normal text-slate-500">{[c.country, c.sector].filter(Boolean).join(" · ")}</span>
                  </th>
                  <td className="px-3 py-2 text-right">{inMillions(c.invested)}</td>
                  <td className="px-3 py-2 text-right">{inMillions(c.realized)}</td>
                  <td className="px-3 py-2 text-right">{inMillions(c.unrealized)}</td>
                  <td className="px-3 py-2 text-right font-medium">{inMillions(c.total_value)}</td>
                  <td className="px-3 py-2 text-right">{c.gross_moic ? `${c.gross_moic.value.toFixed(2)}x` : "—"}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{inMillions(c.revenue_ltm)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{inMillions(c.ebitda_ltm)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{inMillions(c.net_debt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {extraction && (extraction.qualitative.key_updates.length > 0 || extraction.qualitative.outlook) && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Key developments</h4>
          <ul className="mt-1 list-disc pl-5 text-slate-700">
            {extraction.qualitative.key_updates.map((u) => <li key={u}>{u}</li>)}
          </ul>
          {extraction.qualitative.outlook && <p className="mt-2 text-slate-600"><span className="font-medium text-slate-700">Outlook: </span>{extraction.qualitative.outlook}</p>}
        </div>
      )}
    </section>
  );
}
