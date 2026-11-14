import { useEffect, useState } from "react";
import { Link } from "react-router";
import { groupKey, visibleVersions } from "../../core/posting/portfolio-view.ts";
import { fetchPortfolio, type PortfolioGroups } from "../lib/api.ts";
import { quarterLabel } from "../lib/format.ts";

const money = (value: number | null, currency: string) => (value === null ? "—" : `${currency} ${(value / 1e6).toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}m`);
const ratio = (value: number | null) => (value === null ? "—" : `${value.toFixed(2)}x`);
const cleared = (c: PortfolioGroups[number]["current"]["cleared"]) => (c.by === "analyst" ? `analyst ${c.analyst}` : `auto-post (${c.policy})`);

// The mock internal portfolio system (SPEC-posting): what reached it, current version first, history kept.
export function PortfolioPage() {
  // Records keep every version (append-only); the current one is shown, earlier ones on request.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setExpanded((open) => {
    const next = new Set(open);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; records: PortfolioGroups }>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetchPortfolio(controller.signal).then((records) => setState({ status: "ready", records }))
      .catch((e: unknown) => { if (!controller.signal.aborted) setState({ status: "error", message: e instanceof Error ? e.message : String(e) }); });
    return () => controller.abort();
  }, []);

  return (
    <section aria-labelledby="portfolio-heading" className="space-y-4">
      <div>
        <h2 id="portfolio-heading" className="text-base font-semibold text-slate-900">Portfolio system <span className="font-normal text-slate-500">(mock)</span></h2>
        <p className="text-sm text-slate-500">What sketch step 8 posted: one record per fund and quarter, the newest version current, older versions kept (shown on request; the long histories come from repeated automated tests).</p>
      </div>
      {state.status === "loading" && <p role="status" className="text-sm text-slate-500">Loading records…</p>}
      {state.status === "error" && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{state.message}</p>}
      {state.status === "ready" && state.records.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">Nothing has been posted yet.</p>
      )}
      {state.status === "ready" && state.records.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">Fund</th><th scope="col" className="px-4 py-2">Period</th>
                <th scope="col" className="px-4 py-2 text-right">NAV</th><th scope="col" className="px-4 py-2 text-right">TVPI</th>
                <th scope="col" className="px-4 py-2 text-right">DPI</th><th scope="col" className="px-4 py-2">Version</th>
                <th scope="col" className="px-4 py-2">Cleared by</th><th scope="col" className="px-4 py-2">Posted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.records.flatMap((g) => {
                const key = groupKey(g);
                const label = `${g.fund_name}, ${quarterLabel(g.period_end)}`; // for people; the key is for the state
                const earlier = g.history.length - 1;
                const open = expanded.has(key);
                return visibleVersions(g, expanded).map((r) => (
                  <tr key={`${g.fund_name}-${g.period_end}-${r.version}`} className={r.superseded ? "bg-slate-50/60 text-slate-400" : "text-slate-800"}>
                    <td className="px-4 py-2">{r.superseded ? "" : <>{g.fund_name}<span className="block text-xs text-slate-500">{g.gp_name}</span></>}</td>
                    <td className="px-4 py-2">{r.superseded ? "" : quarterLabel(g.period_end)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(r.nav, r.currency)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{ratio(r.tvpi)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{ratio(r.dpi)}</td>
                    <td className="px-4 py-2">
                      v{r.version}{r.superseded ? " · superseded" : " · current"}
                      {!r.superseded && earlier > 0 && (
                        <button type="button" aria-expanded={open} onClick={() => toggle(key)}
                          aria-label={`${open ? "Hide" : "Show"} ${earlier} earlier version${earlier === 1 ? "" : "s"} of ${label}`}
                          className="ml-2 text-xs text-slate-600 underline underline-offset-2 hover:text-slate-900">
                          {open ? "hide" : `${earlier} earlier`}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2">{cleared(r.cleared)}</td>
                    <td className="px-4 py-2"><Link to={`/runs/${r.source_run}`} className="underline">{new Date(r.posted_at).toLocaleString("en-GB")}</Link></td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
