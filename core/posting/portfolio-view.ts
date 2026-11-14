// The mock portfolio system as its users see it: one record per fund and period, the newest version current, the
// older versions kept as history (superseded, never edited).
export type Cleared = { by: "auto_post"; policy: string } | { by: "analyst"; analyst: string; reason: string | null };
export type PortfolioRow = {
  fund_id: string; fund_name: string; gp_name: string; period_end: string; version: number; posted_at: string; source_run: string;
  currency: string; nav: number | null; tvpi: number | null; dpi: number | null; cleared: Cleared;
};
export type PortfolioRecordView = PortfolioRow & { superseded: boolean };

// A stored record (its key columns and the posted payload's fields) as the portfolio page shows it.
export function toPortfolioRow(meta: Pick<PortfolioRow, "fund_id" | "period_end" | "version" | "posted_at" | "source_run">,
  payload: { gp_name: unknown; fund_name: unknown; currency: unknown; fund: unknown; provenance: unknown }): PortfolioRow {
  const fund = payload.fund as Record<string, { value: number } | null>;
  const provenance = payload.provenance as { cleared: PortfolioRow["cleared"] };
  return {
    ...meta, gp_name: String(payload.gp_name), fund_name: String(payload.fund_name), currency: String(payload.currency),
    nav: fund.nav?.value ?? null, tvpi: fund.tvpi?.value ?? null, dpi: fund.dpi?.value ?? null, cleared: provenance.cleared,
  };
}
export type PortfolioGroup = { fund_name: string; gp_name: string; period_end: string; current: PortfolioRecordView; history: PortfolioRecordView[] };

export function groupRecords(rows: PortfolioRow[]): PortfolioGroup[] {
  const groups = Map.groupBy(rows, (r) => `${r.fund_id}:${r.period_end}`);
  return [...groups.values()].map((versions) => {
    const history = [...versions].sort((a, b) => b.version - a.version).map((r, i) => ({ ...r, superseded: i > 0 }));
    const current = history[0] as PortfolioRecordView;
    return { fund_name: current.fund_name, gp_name: current.gp_name, period_end: current.period_end, current, history };
  }).sort((a, b) => b.current.posted_at.localeCompare(a.current.posted_at));
}

// The portfolio page shows each record's current version, its earlier versions on request. A
// record is one fund and period end (fund names are unique in the registry); the full date, not the quarter, so two
// records in one quarter never share a toggle. Typed structurally: the browser's validated response has no fund id.
export const groupKey = (g: { fund_name: string; period_end: string }) => `${g.fund_name}:${g.period_end}`;

export const visibleVersions = <T>(g: { fund_name: string; period_end: string; current: T; history: T[] }, expanded: ReadonlySet<string>): T[] =>
  expanded.has(groupKey(g)) ? g.history : [g.current];
