// Read B for workbooks (SPEC-pipeline decision 5, SPEC-confidence "Read B"): a deterministic, label-anchored lookup in
// the cell grid. It never sees read A's values: it finds each key figure's label cell among known wordings and takes
// the next value to its right, and finds company totals under a "Total value" header. Independent of read A by method
// (code, not a model), as the PDF read B is by modality (image, not text). No LLM call.
import type { ParsedPage } from "../pipeline/parse.ts";
import type { RawValue } from "../pipeline/prompts/extract.ts";
import type { ReadBOutput } from "./compare.ts";
import type { FundKeyFigure } from "./policy.ts";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Whole-label wordings (normalized) seen in GP statements. Whole labels only: "Unfunded commitments" is not one.
const LABELS: Record<FundKeyFigure, string[]> = {
  commitment: ["total commitments", "total commitment", "commitments", "commitment", "committed capital", "total committed capital"],
  paid_in: ["paid in capital", "paid in", "contributed capital", "called capital", "capital called", "total paid in capital"],
  distributions: ["cumulative distributions", "distributions to date", "distributed capital", "distributions", "total distributions"],
  nav: ["net asset value", "net asset value nav", "nav", "portfolio nav", "capital account balance"],
  tvpi: ["tvpi", "net tvpi", "tvpi net"],
  dpi: ["dpi", "net dpi", "dpi net"],
};
const TOTAL_ROW = /^(total|sum|all investments|total holdings|total portfolio)\b/i;

type Cell = { col: number; row: number; text: string };

function cells(page: ParsedPage): Cell[] {
  const out: Cell[] = [];
  for (const line of page.text.split("\n")) {
    for (const m of line.matchAll(/(?:^| \| )([A-Z]{1,3})(\d+): (.*?)(?= \| [A-Z]{1,3}\d+: |$)/g)) {
      const col = [...(m[1] ?? "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      out.push({ col, row: Number(m[2]), text: m[3] ?? "" });
    }
  }
  return out;
}

export function xlsxReadB(pages: ParsedPage[]): ReadBOutput {
  const none: RawValue = { raw: null, page: null };
  const fund = Object.fromEntries(Object.keys(LABELS).map((k) => [k, none])) as Record<FundKeyFigure, RawValue>;
  const companies: ReadBOutput["companies"] = [];

  for (const page of pages) {
    const grid = cells(page);
    const rightOf = (label: Cell) => grid.filter((c) => c.row === label.row && c.col > label.col && c.text !== "")
      .sort((a, b) => a.col - b.col)[0];

    for (const [key, wordings] of Object.entries(LABELS) as [FundKeyFigure, string[]][]) {
      if (fund[key].raw !== null) continue; // first occurrence wins (the statement, not a later restatement table)
      const label = grid.find((c) => wordings.includes(norm(c.text)));
      const value = label && rightOf(label);
      if (value) fund[key] = { raw: value.text, page: page.page };
    }

    const header = grid.find((c) => /^total value\b/.test(norm(c.text)));
    if (!header || companies.length > 0) continue;
    const nameCol = Math.min(...grid.filter((c) => c.row === header.row).map((c) => c.col));
    const rows = [...new Set(grid.filter((c) => c.row > header.row).map((c) => c.row))].sort((a, b) => a - b);
    for (const [i, row] of rows.entries()) {
      if (row !== (i === 0 ? header.row : rows[i - 1] ?? 0) + 1) break; // a blank row ends the table
      const name = grid.find((c) => c.row === row && c.col === nameCol)?.text ?? "";
      if (!name || TOTAL_ROW.test(name)) break; // the table ends at its total row (or the first gap)
      const total = grid.find((c) => c.row === row && c.col === header.col);
      companies.push({ name, total_value: total ? { raw: total.text, page: page.page } : none });
    }
  }
  return { fund, companies };
}
