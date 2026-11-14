// The golden set (SPEC-evals): the corpus labels, plus every analyst correction harvested from the review log. A
// correction on a corpus document is cross-checked against the label (a disagreement is reported, never trusted
// silently); on an upload it is the only ground truth there is.
import type { CorpusLabel, Extraction } from "../schema.ts";

export type HarvestedCorrection = {
  document_sha256: string; filename: string; corpus_doc_id: string | null; field: string;
  raw: string; page: number; value: number | null; analyst: string; decided_at: string;
};
export type GoldenCorrection = {
  document_sha256: string; doc_id: string | null; filename: string; field: string; expected_raw: string; expected_value: number | null;
  page: number; agrees_with_label: boolean | null; analyst: string; times: number; last_decided_at: string;
};
export type Golden = {
  documents: Pick<CorpusLabel, "doc_id" | "file" | "split" | "format" | "expected" | "expected_route" | "expected_flags">[];
  corrections: GoldenCorrection[];
  disagreements: { doc_id: string; field: string; label_value: number | null; corrected_value: number | null; analyst: string }[];
};

function valueAt(e: Extraction, path: string): number | null {
  const fund = /^fund\.(\w+)$/.exec(path);
  if (fund) return (e.fund as Record<string, { value: number } | null>)[fund[1] ?? ""]?.value ?? null;
  const company = /^portfolio_companies\[(\d+)\]\.(\w+)$/.exec(path);
  const row = company ? (e.portfolio_companies[Number(company[1])] as Record<string, unknown> | undefined) : undefined;
  return (row?.[company?.[2] ?? ""] as { value: number } | null | undefined)?.value ?? null;
}
const same = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)));

export function buildGolden(labels: CorpusLabel[], corrections: HarvestedCorrection[]): Golden {
  const byDoc = new Map(labels.map((l) => [l.doc_id, l]));
  const merged = new Map<string, GoldenCorrection>();
  for (const c of [...corrections].sort((a, b) => a.decided_at.localeCompare(b.decided_at))) {
    const key = `${c.document_sha256}|${c.field}|${c.raw}|${c.page}`;
    const seen = merged.get(key);
    if (seen) { seen.times++; seen.last_decided_at = c.decided_at; continue; }
    const label = c.corpus_doc_id ? byDoc.get(c.corpus_doc_id) : undefined;
    merged.set(key, {
      document_sha256: c.document_sha256, doc_id: c.corpus_doc_id, filename: c.filename, field: c.field,
      expected_raw: c.raw, expected_value: c.value, page: c.page,
      agrees_with_label: label ? same(c.value, valueAt(label.expected, c.field)) : null,
      analyst: c.analyst, times: 1, last_decided_at: c.decided_at,
    });
  }
  const goldenCorrections = [...merged.values()].sort((a, b) => `${a.filename}${a.field}`.localeCompare(`${b.filename}${b.field}`));
  return {
    documents: [...labels].sort((a, b) => a.doc_id.localeCompare(b.doc_id)).map(({ doc_id, file, split, format, expected, expected_route, expected_flags }) =>
      ({ doc_id, file, split, format, expected, expected_route, expected_flags })),
    corrections: goldenCorrections,
    disagreements: goldenCorrections.filter((c) => c.agrees_with_label === false).map((c) => ({
      doc_id: c.doc_id ?? "", field: c.field, label_value: valueAt((byDoc.get(c.doc_id ?? "") as CorpusLabel).expected, c.field),
      corrected_value: c.expected_value, analyst: c.analyst,
    })),
  };
}
