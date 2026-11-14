# Spec: evals

Module id: `evals` · Depends on: `corpus`, `pipeline`, `confidence`, `review` · Status: **approved** 2026-10-11

## Objective
The improvement loop from the process sketch, made executable:
**golden eval set → error analysis (first bad step) → fix the cheapest step first → eval gate in CI → shadow → canary →
ship.** Every change to a prompt, a model, a check or the confidence policy is measured on the same golden set before
it ships, and a change that makes the system worse cannot be merged.

Business goal, in priority order:
1. **Never ship a regression in safety:** zero auto-posted documents with a wrong key figure, enforced by CI.
2. **Know where errors come from:** every wrong value is attributed to the first pipeline step that got it wrong, so
   effort goes to the cheapest fix (a normalizer rule before a prompt, a prompt before a model).
3. **Change models on evidence:** a cheaper model (Sonnet 5.5, Haiku 5.5) replaces Opus 5.5 on a step only when the
   shadow run on the golden set shows no loss of key-figure accuracy (SPEC-pipeline decision 1).

**Users:** the engineer changing a prompt or model (gets a pass/fail and a report), the reviewer of a pull request (sees
the eval gate), a reviewer (sees the loop working on real numbers), and the showcase page (shows the latest
results).

## The golden set
- **Corpus labels:** the 18 documents with their expected extraction, flags and route (SPEC-corpus). Dev (12) and
  held-out (6) stay separate.
- **Analyst corrections:** every `field_corrected` decision becomes an eval case (document sha256, field, expected value
  and page). For uploads, these are the only labels there are; for corpus documents they are cross-checked against the
  label (a correction that disagrees with the label is reported, not silently used).
- **Versioned:** `evals/golden.json` is generated from the labels and the exported corrections (`npm run eval:harvest`),
  committed, and reviewed like code.

## Metrics (all graded by code against labels; no LLM judge)
| Metric | Definition | Gate |
|---|---|---|
| Unsafe auto-posts | documents routed `auto_post` with any key figure different from the label | **= 0, hard** |
| Key-figure accuracy | key figures equal to the label after normalization, over all dev documents | no regression vs baseline |
| All-figure accuracy | every extracted figure (operating metrics included) | reported |
| Classification accuracy | GP, fund, period, currency, report type | no regression |
| Route accuracy | route equals `expected_route` | no regression |
| Cost and latency | per document and per step, from the recorded usage | reported (and compared in shadow runs) |

## Error analysis: the first bad step
For every wrong value, the earliest step whose output already disagrees with the label:
2 classify (classification) · 3 parse/OCR (the printed value is absent from the page text) · 4 extract (round 0
disagrees) · 5 normalize (raw string right, value wrong) · 6 critic (round 0 right, a later round wrong, or a failed check
the critic could have fixed) · 7 confidence (values right, route wrong). The report counts errors per step and lists
them, so the cheapest fix is visible ("4 errors in step 3: OCR lost decimal points").

## Runner and gate
- `npm run eval`: the dev split through steps 2-7 by **replay** (recorded LLM answers, $0, ~1 min), writes
  `evals/reports/<date>-<pipeline version>.json` and a markdown summary; compares with `evals/baseline.json`.
- **CI gate:** a CI job runs `npm run eval` and fails when a gated metric is worse than the baseline or unsafe > 0. A
  change that alters prompts must re-record its fixtures (replay misses fail the job with the recording command).
- `npm run eval:live -- --split heldout`: the held-out split on the live site (budget-guarded, manual only). Never in CI
  and never used to tune: its result is reported as is.
- The baseline moves only by an explicit commit of `evals/baseline.json` (reviewed like code).

## Shadow, canary, ship
- **Shadow:** `npm run eval:shadow -- --step <step> --model <model>` re-runs the dev split with one step on a candidate
  model or prompt version (live calls, recorded as candidate fixtures, budget-guarded) and produces a side-by-side
  report: accuracy, unsafe auto-posts, cost and latency per document, baseline vs candidate.
- **Canary and ship (described, not built):** in production a candidate would first run in shadow on live traffic
  (results stored, never routed), then on a small share of traffic, then ship. In this prototype "ship" is a pull
  request changing the step's model, which the CI gate must pass.
- **First experiment:** Sonnet 5.5 and Haiku 5.5 for each LLM step (classify, extract, critic, read B), one at a time.

## Project Structure (additions)
```
evals/golden.json            → generated golden set (labels + harvested corrections)
evals/baseline.json          → gated metrics of the accepted version
evals/reports/               → one report per run (JSON + markdown)
core/evals/metrics.ts        → pure: compare an extraction / route with the golden case
core/evals/first-bad-step.ts → pure: attribute each wrong value to a step
scripts/eval.ts, eval-harvest.ts, eval-shadow.ts
.github/workflows/ci.yml     → eval job
```

## Code Style
As in SPEC-platform. Metrics and attribution are pure functions over plain data, with table-driven tests.

## Testing Strategy
- **Unit:** each metric on hand-made cases (equal, different, missing, extra company); first-bad-step attribution for
  every step, one test per row of the table above; gate comparison (pass, regression, unsafe > 0).
- **Mutation check of the gate:** a deliberately broken normalizer must make `npm run eval` fail in CI.
- **Self-check:** the eval on the current dev split reproduces the numbers already measured (12 documents, 11 routes
  as labeled, 0 unsafe).

## Boundaries
- **Always:** grade by code against labels; keep dev and held-out apart; record cost with every live eval.
- **Ask first:** moving the baseline down; adding an LLM judge; running shadow experiments over $2; changing a step's
  production model (even when the shadow run passes).
- **Never:** tune on held-out; let the gate be skipped; count a correction as ground truth when it disagrees with a
  corpus label without reporting it.

## Success Criteria
1. `npm run eval` on the dev split reports the measured state (11/12 routes, 0 unsafe, key-figure accuracy) in under
   2 minutes at $0, and CI runs it on every push.
2. A deliberately broken normalizer makes the CI eval job fail; reverting it makes it pass.
3. Every wrong value in the report names its first bad step; the scans' errors are attributed to step 3 (OCR).
4. The analyst corrections in the database are harvested into the golden set, and a correction that disagrees with a
   label is reported.
5. One shadow experiment (Sonnet 5.5 on one step) produces a side-by-side report with accuracy, unsafe auto-posts and
   cost, and a recommendation that follows decision 1 (switch only if key-figure accuracy holds).
6. The held-out measurement can be re-run on demand and is reported as is.

## Decisions (approved 2026-10-11)
1. **Grading:** code only, against labels; no LLM judge (every target is a number or a label).
2. **Gate:** unsafe auto-posts = 0 is absolute; key-figure, classification and route accuracy must not fall below the
   committed baseline.
3. **Shadow:** offline on the dev split, one step at a time, Sonnet 5.5 first, then Haiku 5.5 (about $0.5-1.5 each);
   live canary described, not built.
4. **Corrections:** harvested on demand into `evals/golden.json` and committed; CI never touches the database.

## Changes during build
- **E6 (2026-10-11): the held-out command is `npm run eval:live -- heldout`** (or `npm run eval:live`, held-out is the
  default), not `-- --split heldout` as written under "Runner and gate": the script takes the split as its first
  argument. A whole candidate configuration is measured with `npm run eval:candidate` (added after the Sonnet held-out
  failure).
- **E5 (2026-10-11): only Sonnet 5.5 was run in shadow, not Haiku 5.5.** Sonnet passed every gated metric on dev, then
  failed held-out (`docs/error-analysis/2026-10-11-sonnet-restatement.md`); a smaller model was not worth measuring
  until that failure mode is understood.
