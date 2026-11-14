# Acceptance: confidence (step 7), 2026-10-11

Spec: [SPEC-confidence.md](../../SPEC-confidence.md) · pipeline@0.7.0 · policy@1 · read B on claude-opus-5-5.
Raw results: [2026-10-11-heldout.json](2026-10-11-heldout.json) (from `node scripts/acceptance.ts heldout`).

## Held-out split, measured once on the deployed site (no tuning)
| Document | Expected | Route | Differences vs label | Unsafe | Read B cost | Read B time |
|---|---|---|---|---|---|---|
| alpenrose-iv-2026q2 | auto_post | auto_post | 0 | no | $0.0292 | 9.3 s |
| harbourline-ii-2026q2 | auto_post | auto_post | 0 | no | $0.0299 | 7.6 s |
| nordkap-iii-2026q2 | auto_post | auto_post | 0 | no | $0.0284 | 8.3 s |
| nordkap-iii-2025q3-restatement | review | review ¹ | 0 | no | $0.0303 | 8.8 s |
| tessera-seed-i-2026q2 | triage | triage | 0 | no | $0 (skipped) | 0.1 s |

¹ **Infrastructure failure, reported as is.** The first run failed in step 1: `download document: The connection to the
database timed out` (run `4546d0e4`). No model call happened. Re-run once without any change (run `e54af98c`):
review, 0 differences. Fix: step 1 now retries transient errors with backoff (`core/retry.ts`, unit-tested); permanent
errors still fail at once.

**How the restatement was routed.** Both reads returned the *revised* NAV from the footnote (349.420, the label value),
without the footnote marker, so the footnote rule did not fire. The document went to review through signal A: the
printed multiples still use the original NAV, so TVPI and RVPI fail while both reads agree, and the analyst sees "the
report itself may be inconsistent". The caveat in SPEC-confidence decision 3 (the footnote rule was written knowing this
trap exists) therefore does not affect this result.

## Success criteria
| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Dev routes == `expected_route` (8 docs, replayed in CI) | pass | `tests/core/pipeline/confidence-replay.test.ts` |
| 2 | Zero `auto_post` with an extraction that differs from its label | pass | dev (replay) + held-out (live): 0 unsafe; plus 60+ injected single-digit misreads, none auto-posted |
| 3 | TVPI misprint: "report itself may be inconsistent", A = B; chart NAV: correlated reads → review | pass | replay test + Run page (K4) |
| 4 | Every assessment stores the policy version and per-figure evidence | pass | `assessments` rows: all `policy@1`, 11–14 figures each, round 0–2 |
| 5 | Run page: route banner + per-figure A / B / checks / level / reason | pass | `src/components/confidence-panel.tsx`, verified on three real runs |
| 6 | Added cost ≤ $0.05, added latency ≤ 20 s per document | pass | read B $0.028–0.030, 7.6–12 s |
| 7 | Held-out routes reported as is | pass | table above: 5 of 5 routes, 0 differences |

## Why the second signal earns its cost
Mutation check (K3): with read-B disagreement ignored, a commitment misread **500.0 → 500.1** passed every financial
check (the unfunded identity tolerates rounding) and was auto-posted. With signal B it goes to review: "Reads disagree
(A: 500.1, B: 500.0): likely a misread." Checks catch numbers that don't add up; only an independent read catches a
number that is wrong but plausible.
