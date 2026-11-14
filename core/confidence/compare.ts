// Read B normalized the same way as read A (same unit statement, same document separators), so "agree" means the
// same value, not the same string: "1,40x" and "1.40x" agree.
import type { Classification } from "../pipeline/classify.ts";
import { documentSeparators } from "../pipeline/normalize-step.ts";
import { normalizeAmount, normalizeRatio, scaleFromUnitStatement } from "../pipeline/normalize.ts";
import type { RawExtraction, RawValue } from "../pipeline/prompts/extract.ts";
import { POLICY, type FundKeyFigure } from "./policy.ts";

export type ReadBOutput = {
  fund: Record<FundKeyFigure, RawValue>;
  companies: { name: string; total_value: RawValue }[];
};
export type ReadBValue = { rawB: string | null; valueB: number | null };
export type ComparedReadB = Map<string, ReadBValue>; // keyed by schema path, e.g. "fund.nav"

export const companyKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function compareReadB(readB: ReadBOutput, rawA: RawExtraction, classification: Classification): ComparedReadB {
  const scale = scaleFromUnitStatement(classification.unit_statement);
  const separators = documentSeparators(rawA);
  const out: ComparedReadB = new Map();
  const amount = (raw: string | null) => {
    if (raw === null || !scale.ok || !separators.ok) return null;
    const r = normalizeAmount(raw, scale.value, separators.value);
    return r.ok ? r.value : null;
  };
  const ratio = (raw: string | null) => {
    if (raw === null) return null;
    const r = normalizeRatio(raw);
    return r.ok ? r.value : null;
  };

  for (const key of POLICY.fundKeyFigures) {
    const rawB = readB.fund[key]?.raw ?? null;
    const isRatio = (POLICY.ratioKeyFigures as readonly string[]).includes(key);
    out.set(`fund.${key}`, { rawB, valueB: isRatio ? ratio(rawB) : amount(rawB) });
  }
  rawA.portfolio.companies.forEach((company, i) => {
    const seen = readB.companies.find((c) => companyKey(c.name) === companyKey(company.name));
    const rawB = seen?.total_value.raw ?? null;
    out.set(`portfolio_companies[${i}].total_value`, { rawB, valueB: amount(rawB) });
  });
  return out;
}
