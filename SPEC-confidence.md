# Spec: confidence

Module id: `confidence` · Depends on: `pipeline` · Status: **approved** 2026-10-11

## Objective
Sketch step 7, **"Confidence high?"**, with the design from my sketch: confidence comes from **two independent
signals**, not from a model's self-reported score.

- **Signal A, checks:** do the financial identities that involve this figure pass? (Step 5, after the step-6 critic.)
- **Signal B, agreement:** does an **independent second read** of the key figures, from the page **images**, give the
  same value as the text-based read A?

From these, code computes a confidence per key figure, a document confidence, and a **route**: `auto_post` (step 8),
`review` (step 9) or `triage` (unknown GP or layout). Every decision comes with **reasons a human can read**, because
the analyst in step 9 must see *why* a document was stopped.

The business goal, in priority order:
1. **Never auto-post a wrong key figure** (precision of `auto_post` = 100% on the corpus).
2. Then maximise straight-through processing (the share of documents posted without a human).

**Users:** the analyst (sees the reasons on the Run page and later in the Review UI), a reviewer (watches
traps get routed correctly), and evals (compare the route with each label's `expected_route`).

## The confidence matrix (per key figure)
| Signal A (checks) | Signal B (reads A and B) | Level | Reason shown to the analyst |
|---|---|---|---|
| pass | agree | **high** | "Checks pass and an independent image read agrees." |
| pass | disagree | low | "Reads disagree (A: x, B: y): likely a misread." Both values shown. |
| fail | agree | low | "Both reads see the same number but the figures don't add up: **the report itself may be inconsistent**." |
| fail | disagree | low | "Figures don't add up and the reads disagree." Both values shown. |

**Not-high cases** (each one yields `medium`, so the document goes to review, never auto-post):
- No independent read B is available for the figure (e.g. B did not find it).
- **The figure came from the vision fallback.** Read A was then also a vision read, so A and B are correlated, and
  their agreement proves less (SPEC-pipeline decision 3: reads must differ in modality to count as independent).
- **The printed figure carries a footnote marker** (`352.4¹`, `*`, `[2]`). A footnoted key figure may be restated or
  qualified (corpus trap 3) and is never auto-posted.
- No check involves the figure at all.

**Low** additionally for: a key figure that is missing (`null`) or has a normalization issue.

**Key figures:** commitment, paid-in, distributions, NAV, TVPI, DPI, and every company's total value
(`FUND_KEY_FIGURES` / `COMPANY_KEY_FIGURES` in schema v1). The document level is the **minimum** over key figures.
Other fields (operating metrics, narrative) get no confidence level, but a failed check or a normalization issue on any
field still blocks `auto_post` (routing rule 2), with the reason shown to the analyst.

## Routing (deterministic code, versioned policy)
1. **triage**: GP unknown (`gp_status: unknown`), classification incomplete, or no valid extraction.
2. **auto_post**: every key figure `high`, no failed check of any kind, no normalization issue.
3. **review**: everything else, with the list of reasons per figure.

Thresholds and rules live in one file (`core/confidence/policy.ts`, now `policy@3`). The policy version is stored with every
assessment, so a routing decision can always be explained later ("why was this posted?").

## Read B: the independent second read
- **Input:** images of the pages where read A found the key figures (130 dpi, the same renderer and identity as the
  vision fallback), plus the classification's unit statement. **It never sees read A's values**: showing them would
  anchor the model and destroy the independence that makes agreement meaningful.
- **Prompt `read-b@1`:** a dedicated, minimal prompt that asks only for the key figures (exactly as printed, with page)
  and the portfolio companies' names and total values. It is not the section-extraction prompt.
- **Comparison (code):** B's raw strings go through the same normalizer. Amounts must match **exactly** after
  normalization (both are transcriptions of the same printed number); ratios within 0.005. Companies are aligned by
  normalized name; a company B does not list counts as "B unavailable" for that figure.
- **XLSX** (SPEC-pipeline decision 5): read B is a deterministic, label-anchored cell lookup instead of a vision read.
- **Cost / latency:** one vision call per document (1–3 page images), about $0.02–0.04 and 10–15 s.

## Data and status
- Run status gains `needs_triage` and `ready_to_post`. `confidence` sets the final status: `ready_to_post` (posting
  picks it up), `needs_review` or `needs_triage`. The run engine finishes with the status the last step decides.
- `assessments` table (append-only): run_id, extraction round assessed, route, document level, per-field JSON
  (path, value A, value B, check state, agreement state, flags, level, reason), reasons, policy version, created_at.

## Commands
Unchanged (SPEC-platform). Recording read B: `node scripts/record-fixtures.ts confidence` (replay-or-record).

## Project Structure (additions)
```
core/confidence/policy.ts       → policy@1: tolerances, footnote markers, key-figure list, routing rules
core/confidence/assess.ts       → pure: (extraction, raw, checks, issues, readB) -> field levels, document level, route, reasons
core/confidence/compare.ts      → normalize read B and compare with read A
core/pipeline/prompts/read-b.ts → read-b@1
core/pipeline/confidence-step.ts→ step 7: run read B, assess, store, set the final status
netlify/lib/run-store.ts        → assessments store; final status
src/components/confidence-panel.tsx → route banner + per-figure A / B / checks / level
```

## Code Style
As in SPEC-platform. The matrix is a **table-driven function**: one row per case above, so the code reads like the
table in this spec, and each row has its own test.

## Testing Strategy
- **Matrix (unit, table-driven):** each row of the confidence matrix and each "not-high" case → expected level and reason.
- **Routing (unit):** triage conditions; auto_post only when everything is high and clean; review otherwise.
- **Comparison (unit):** exact amount match after normalization; ratio tolerance; company alignment by name; a missing B value.
- **Independence guard (unit):** the read-B request contains no read-A value (asserted on the request text).
- **Replay on the dev split:** every dev document's route equals its label's `expected_route` (clean → auto_post,
  TVPI misprint → review as a source inconsistency, chart NAV → review because of the vision fallback).
- **Safety property (corpus-wide, replayed):** no document whose extraction differs from its label is routed `auto_post`.
- **Live acceptance (held-out, measured once, no tuning):** Tessera → triage; restatement → review; Q2 documents of all
  three GPs → auto_post with exact values.

## Boundaries
- **Always:** reasons in plain language for every non-high figure; the policy version stored with every assessment;
  read B blind to read A.
- **Ask first:** changing a threshold or matrix rule (it changes what gets posted without a human); using a different
  model for read B.
- **Never:** route `auto_post` with any failed check, normalization issue, missing key figure or footnoted key figure;
  let an LLM decide the route or report a confidence number; show read A's values to read B.

## Success Criteria
1. Dev split: route == `expected_route` for all 8 dev documents (replayed in CI).
2. Safety: zero `auto_post` on any corpus document whose extraction differs from its label.
3. TVPI misprint shows the reason "the report itself may be inconsistent" with both reads equal; chart NAV shows
   "read from image: correlated reads" and routes to review.
4. Every assessment stores the policy version and the per-figure A / B / check / level evidence.
5. The Run page shows the route banner and, per key figure: value A, value B, checks, level and reason.
6. Added cost per document ≤ $0.05; added latency ≤ 20 s.
7. Held-out live measurement reported as is (no tuning): routes for Tessera, the restatement and the three Q2 documents.

## Decisions (approved 2026-10-11)
1. **Read B model:** Opus 5.5 (independence through modality: text vs image). Sonnet 5.5 for read B is measured in
   the eval module before any change.
2. **Figures from the vision fallback always go to review** (two vision reads are correlated).
3. **Footnote rule kept:** a footnoted key figure is never auto-posted. Disclosed trade-off: the rule was written
   knowing that the held-out restatement trap exists, so that document's held-out result is reported with this caveat.
   The rule stays because it targets a real-world pattern (restatements and qualifications live in footnotes), costs
   nothing, and is a policy rather than a fit to one document; safety ranks above held-out purity here.
4. **Statuses:** `ready_to_post`, `needs_review`, `needs_triage`.
5. **Only key figures get a confidence level** (two reads, the matrix above). Clarified 2026-10-11, decided by the
   product owner: **routing rule 2 stands**, so a failed check or a normalization issue on *any* field (e.g. an
   OCR-damaged country code, an EBITDA above revenue) sends the document to review. A report whose data could not all
   be read gets a quick human look; it costs straight-through processing on scans, and nothing wrong is posted.
6. **policy@2 (2026-10-11, product owner): uploaded documents never auto-post.** An upload names no fund, so a crafted
   file that prints another known fund's name could attach its figures to that fund (security audit, prompt injection).
   Every upload goes to review with the reason "Uploaded documents are always reviewed by an analyst before posting".
   Corpus documents keep the full two-signal routing, so the demo still shows auto-posting.
7. **policy@3 (2026-10-11, product owner): a footnote marker in either read keeps a key figure from auto-posting.**
   On held-out, with read A on Sonnet 5.5, read A took a restated NAV from the table (consistent with every ratio) while
   read B printed its footnote marker; the rule only looked at read A
   (`docs/error-analysis/2026-10-11-sonnet-restatement.md`). Disclosure: the change is motivated by a held-out failure,
   so the next held-out result for the restatement document is not an unbiased measurement; the rule targets a general
   pattern (the second read noticing a qualification the first read missed).
