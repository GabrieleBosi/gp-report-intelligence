// The record posted to the internal portfolio system (SPEC-posting "What gets posted"): the latest extraction round,
// so an analyst's corrections are what gets posted, with identity and provenance. Validated the way a real system
// would validate it, and hashed over its figures so a re-post of identical figures can be recognised as unchanged.
import { sha256Hex } from "../hash.ts";
import { err, ok, type Result } from "../result.ts";
import { FUND_KEY_FIGURES, type Extraction } from "../schema.ts";

export type RecordDecision = { kind: string; field: string | null; before: { raw?: unknown } | null; after: { raw?: unknown } | null;
  analyst: string; reason: string | null };
export type RecordInput = {
  runId: string; status: string; documentSha256: string; pipelineVersion: string; knownFundId: string | null;
  extraction: Extraction; policy: string; decisions: RecordDecision[];
};
export type PortfolioRecord = {
  fund_id: string; gp_name: string; fund_name: string; period_end: string; currency: string; report_type: string;
  fund: Extraction["fund"]; companies: Extraction["portfolio_companies"];
  provenance: {
    run_id: string; document_sha256: string; pipeline_version: string; policy: string;
    cleared: { by: "auto_post"; policy: string } | { by: "analyst"; analyst: string; reason: string | null };
    corrections: { field: string; before: string; after: string; analyst: string }[];
  };
  figures_hash: string;
};

// Canonical JSON (sorted keys) of what the figures are, without page sources: the same numbers give the same hash.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((k) => k !== "source").sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function buildRecord(input: RecordInput): Promise<Result<PortfolioRecord>> {
  const { classification: c, fund, portfolio_companies: companies } = input.extraction;
  const missing = [
    ...(input.knownFundId ? [] : ["fund id (not in the registry)"]),
    ...FUND_KEY_FIGURES.filter((k) => fund[k] === null),
  ];
  if (missing.length > 0) return err("invalid_record", `The portfolio system needs: ${missing.join(", ")}.`);

  const approval = [...input.decisions].reverse().find((d) => d.kind === "approved");
  const cleared = input.status === "approved" && approval
    ? { by: "analyst" as const, analyst: approval.analyst, reason: approval.reason }
    : { by: "auto_post" as const, policy: input.policy };
  const corrections = input.decisions.filter((d) => d.kind === "field_corrected" && d.field).map((d) => ({
    field: d.field ?? "", before: String(d.before?.raw ?? ""), after: String(d.after?.raw ?? ""), analyst: d.analyst,
  }));
  const figures = { fund_id: input.knownFundId, period_end: c.period_end, currency: c.currency, fund, companies };
  return ok({
    fund_id: input.knownFundId ?? "", gp_name: c.gp_name, fund_name: c.fund_name, period_end: c.period_end, currency: c.currency,
    report_type: c.report_type, fund, companies,
    provenance: { run_id: input.runId, document_sha256: input.documentSha256, pipeline_version: input.pipelineVersion,
      policy: input.policy, cleared, corrections },
    figures_hash: await sha256Hex(canonical(figures)),
  });
}
