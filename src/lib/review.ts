import type { AssessmentView, DecisionView } from "../../core/pipeline/run-view.ts";

export type ChecklistRow = AssessmentView["fields"][number] & { state: "pending" | "accepted" | "corrected" | "ok" };
const ORDER = { low: 0, medium: 1, high: 2 } as const;

// The analyst's checklist: figures needing attention first, each with the latest decision taken on it.
export function reviewChecklist(assessment: AssessmentView, decisions: DecisionView[]): ChecklistRow[] {
  const latest = new Map<string, DecisionView["kind"]>();
  for (const d of decisions) if (d.field && (d.kind === "field_accepted" || d.kind === "field_corrected")) latest.set(d.field, d.kind);
  return [...assessment.fields]
    .sort((a, b) => ORDER[a.level] - ORDER[b.level])
    .map((f) => {
      const decided = latest.get(f.path);
      return { ...f, state: decided === "field_corrected" ? "corrected" : decided === "field_accepted" ? "accepted" : f.level === "high" ? "ok" : "pending" };
    });
}

// What still stands between the analyst and an approval (the server enforces the same rules: core/review/actions.ts).
export function approvalBlockers(rows: ChecklistRow[], failedChecks: string[]): { pending: string[]; reasonRequired: boolean } {
  return { pending: rows.filter((r) => r.state === "pending").map((r) => r.label), reasonRequired: failedChecks.length > 0 };
}

type Printed = { raw?: string | null; page?: number | null };
type RawLike = { fund?: Record<string, Printed | undefined>;
  portfolio?: { companies: ({ name: string } & Record<string, unknown>)[] }; operating?: { companies: ({ name: string } & Record<string, unknown>)[] } };

// The value as printed and the page a figure was read from (fund, portfolio table or operating table).
export function printedAt(raw: RawLike, path: string): { raw: string | null; page: number | null } {
  const fund = /^fund\.(\w+)$/.exec(path);
  const company = /^portfolio_companies\[(\d+)\]\.(\w+)$/.exec(path);
  let value: Printed | undefined;
  if (fund) value = raw.fund?.[fund[1] ?? ""];
  else if (company) {
    const row = raw.portfolio?.companies[Number(company[1])];
    const ops = raw.operating?.companies.find((o) => o.name === row?.name);
    value = (row?.[company[2] ?? ""] ?? ops?.[company[2] ?? ""]) as Printed | undefined;
  }
  return { raw: value?.raw ?? null, page: value?.page ?? null };
}

// The page a figure was read from, so the source view can show it next to the figure.
export const pageOf = (raw: RawLike, path: string) => printedAt(raw, path).page;

const FIELD_LABELS: Record<string, string> = {
  invested: "invested", realized: "realized", unrealized: "unrealized", total_value: "total value", gross_moic: "gross MOIC",
  revenue_ltm: "revenue LTM", ebitda_ltm: "EBITDA LTM", net_debt: "net debt",
};
export type CheckRow = { path: string; label: string; reason: string; corrected: boolean };

// Figures named by a failed check that are not key figures (e.g. an OCR-lost EBITDA decimal): correctable on screen.
// They do not block approval (only key figures do), but a still-failing check makes the approval reason mandatory.
export function checkRows(checks: { status: string; message: string; fields: string[]; failing?: string[] }[],
  assessment: AssessmentView | null, companies: { name: string }[], decisions: DecisionView[]): CheckRow[] {
  const key = new Set(assessment?.fields.map((f) => f.path));
  const corrected = new Set(decisions.filter((d) => d.kind === "field_corrected").map((d) => d.field));
  const rows = new Map<string, CheckRow>();
  for (const check of checks.filter((c) => c.status === "fail")) {
    for (const path of check.failing ?? check.fields) {
      if (key.has(path) || rows.has(path)) continue;
      const m = /^portfolio_companies\[(\d+)\]\.(\w+)$/.exec(path);
      const label = m ? `${companies[Number(m[1])]?.name ?? "Company"}: ${FIELD_LABELS[m[2] ?? ""] ?? m[2]}` : path;
      rows.set(path, { path, label, reason: check.message, corrected: corrected.has(path) });
    }
  }
  return [...rows.values()];
}
