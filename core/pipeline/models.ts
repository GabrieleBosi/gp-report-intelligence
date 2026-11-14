// Model per LLM step (SPEC-pipeline decision 1: a cheaper model replaces Opus 5.5 on a step only when the eval shows no
// loss). Evidence: evals/shadow/2026-10-11-summary.md, approved by the product owner on 2026-10-11:
// - classify, extract, read B (confidence): Sonnet 5.5 held every gated metric on the dev split at about half the cost,
//   and as read B it caught the injected misreads exactly as Opus did (97 misreads, 0 auto-posted).
// - critic: kept on Opus 5.5; only 2 critic calls on the dev split, too few to judge.
// Changing an entry changes what gets posted without a human: measure with npm run eval:shadow, then ask first.
// ROLLED BACK 2026-10-11 (pipeline@0.12.1): on the held-out split the Sonnet configuration auto-posted the restatement
// trap with a wrong NAV (read A took the table value, consistent with every ratio; read B saw the footnote marker, which
// the footnote rule only checks on read A). All steps are back on Opus 5.5, the last configuration measured safe on
// held-out, until the policy gap is closed and the switch is re-measured
// (docs/error-analysis/2026-10-11-sonnet-restatement.md).
export const STEP_MODELS = {
  classify: "claude-opus-5-5",
  extract: "claude-opus-5-5",
  critic: "claude-opus-5-5",
  confidence: "claude-opus-5-5",
} as const;
