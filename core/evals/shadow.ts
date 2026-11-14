// Shadow runs (SPEC-evals): one step on a candidate model, the rest unchanged, scored on the golden set. The verdict
// follows SPEC-pipeline decision 1: a cheaper model is eligible only if no gated metric gets worse; switching is still
// an "ask first" change.
import { checkGate } from "./gate.ts";
import type { Summary } from "./metrics.ts";

export type ShadowComparison = { step: string; model: string; baseline: Summary; candidate: Summary;
  baselineCostUsd: number; candidateCostUsd: number; verdict: "eligible" | "keep"; saving: number; reason: string };

export function compareShadow(input: Omit<ShadowComparison, "verdict" | "saving" | "reason">): ShadowComparison {
  const gate = checkGate(input.candidate, input.baseline);
  const saving = Math.round((input.baselineCostUsd - input.candidateCostUsd) * 100) / 100;
  const share = input.baselineCostUsd > 0 ? Math.round((saving / input.baselineCostUsd) * 100) : 0;
  return gate.pass
    ? { ...input, verdict: "eligible", saving,
      reason: `No gated metric is worse on the dev split; ${input.model} on ${input.step} saves $${saving.toFixed(2)} (${share}%) per pass. Switching changes production: ask first.` }
    : { ...input, verdict: "keep", saving, reason: `Keep the current model: ${gate.failures.join("; ")}.` };
}
