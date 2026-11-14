// From what a run stored to the record input (S1), and the one entry point every posting path uses: the end of the
// pipeline, an approval, and a retry (SPEC-posting).
import { matchKnownFund, type KnownFund } from "../pipeline/classify.ts";
import { err, type Result } from "../result.ts";
import type { Extraction } from "../schema.ts";
import { postRun, type PortfolioSystem, type PostingLog, type PostResult } from "./post.ts";
import type { RecordDecision, RecordInput } from "./record.ts";

export type StoredPosting = {
  run: { id: string; status: string; pipeline_version: string };
  documentSha256: string;
  classify: Record<string, unknown>; // the classify step's audit summary
  extraction: Extraction; // the latest round (analyst corrections included)
  policy: string;
  decisions: RecordDecision[];
  knownFunds: KnownFund[];
};

// The registry fund: an analyst's triage assignment first, then the id classify recorded, then (runs recorded before
// classify stored the id) the same registry match classify uses.
export function recordInputFrom(s: StoredPosting): RecordInput {
  const assigned = [...s.decisions].reverse().find((d) => d.kind === "fund_assigned");
  const byAssignment = assigned ? s.knownFunds.find((f) => f.fund_name === assigned.after?.raw)?.id : undefined;
  const recorded = typeof s.classify.known_fund_id === "string" ? s.classify.known_fund_id : undefined;
  const match = matchKnownFund(s.extraction.classification.fund_name, s.knownFunds);
  return {
    runId: s.run.id, status: s.run.status, documentSha256: s.documentSha256, pipelineVersion: s.run.pipeline_version,
    knownFundId: byAssignment ?? recorded ?? (match.status === "known" ? match.fundId : null),
    extraction: s.extraction, policy: s.policy, decisions: s.decisions,
  };
}

export async function postStoredRun(deps: { load(runId: string): Promise<StoredPosting | null>; system: PortfolioSystem; log: PostingLog },
  runId: string): Promise<Result<PostResult>> {
  const stored = await deps.load(runId);
  if (!stored) return err("not_found", "Run not found, or nothing was extracted to post.");
  return postRun(deps, recordInputFrom(stored));
}
