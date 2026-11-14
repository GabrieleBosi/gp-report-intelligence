# Spec: pipeline

Module id: `pipeline` · Depends on: `platform`, `corpus` · Status: **approved** 2026-10-11

## Objective
Turn a received GP report into a **normalized, checked extraction** that step 7 (`confidence`) can score and route.
This module covers sketch steps 2–6 and the orchestration around them:

| Step | Column in sketch | What it does here | Who |
|---|---|---|---|
| 2 Classify | AI | GP, fund, period, report type, currency → matched against the known-fund registry | LLM proposes, **code decides** the match |
| 3 Parse by format / OCR | System | Text per page from the PDF text layer, OCR for scans, cell grid for XLSX, page images on demand | Code |
| 4 Extract per section | AI | One call per section (fund figures, portfolio, operating metrics, qualitative), JSON-schema output, values **as printed** | LLM |
| 5 Normalize + rules | System | Raw strings → numbers (scale, sign, locale) → schema v1 → financial identity checks | Code |
| 6 Critic | AI | Re-reads the source for the fields involved in failed checks: confirm as printed, correct a transcription, or flag. Max 2 rounds | LLM |

**Principle (from the sketch): the LLM only where code can't.** The LLM locates and transcribes; code parses numbers,
applies units and does the arithmetic. Every number in the output can be traced to a page and a raw printed string.

**Done means:** uploading or selecting a document starts a run. The run shows its steps live, and ends with an
extraction, check results and a full audit trail. Native-PDF reports extract with **every key figure exact**
(after normalization), and a trap document's inconsistency survives the critic as a flag rather than being "fixed".

## Assumptions (correct me)
1. **Anthropic SDK, default model `claude-opus-5-5`** for every LLM step (the skill default; see Open Question 1
   on cheaper models), with effort set per step: classify `low`, extract `medium`, critic `high`.
2. **Structured outputs** (`output_config.format`, validated with zod) for every LLM step. Forced `tool_choice` returns
   a 400 on Opus 5.5, so it isn't an option.
3. **Server-side refusal fallback enabled by default** (`fallbacks: "default"`), as the Claude API guidance
   recommends for Opus 5.5. A financial report should never trigger it, but a refusal must not crash a run.
4. **Read A is always text-based** (text layer, OCR or cell grid) and **page images are produced on demand**, for the
   vision fallback here and for the independent vision read B in `confidence`. Keeping the modalities separate
   is what makes the two reads in step 7 meaningfully independent.
5. The pipeline **never reads `documents.corpus_meta` or labels**. Classification comes from the document only.

## Architecture
```
POST /api/runs {document_id}
  └─ creates pipeline_runs(queued) ─► run-pipeline-background (Netlify background fn, ADR-0002)
        core/pipeline/run.ts  (pure orchestration, all I/O through ports)
          2 classify ─► 3 parse ─► 4 extract (sections in parallel) ─► 5 normalize+check ─► 6 critic ≤2 ─► extracted
          each step: budget check → LLM/code → audit_events row → usage_ledger rows
GET /api/runs/:id  → status, step timeline (from audit_events), latest extraction, check results
UI: "Run" on the Documents page → Run page (live step timeline, values with page refs, failed checks)
```
**Ports (ADR-0001):** `LlmClient` (Anthropic implementation, plus a **record/replay** implementation for tests and CI),
`DocumentStore` (exists), `RunStore`, `Rasterizer`, `Ocr`. All pipeline logic is unit-testable with fakes and no network.

### Step details
**2 Classify.** Input is the text of the first 2 pages (or their images for scans). Output: gp_name, fund_name, period_end,
report_type, currency, and the statement of units as printed ("all amounts in TEUR"). Code fuzzy-matches the fund name
against a **`known_funds` registry** (the four known GPs; an investor knows who it invests with). No match means
`gp_status = unknown`: extraction still runs to give the analyst a draft, but the run is marked for **triage**,
whatever its confidence (sketch: "unknown GP or layout → triage + add to evals").

**3 Parse.** PDF with a usable text layer: text per page with line order preserved (pdf.js). PDF without one (fewer than
~50 characters per page): rasterize → OCR → text per page plus the OCR confidence. XLSX: one "page" per sheet as a cell
grid with A1 references. Output is a `ParsedDocument` recording, per page, `source: text_layer | ocr | sheet` and `quality`.

**4 Extract.** Four parallel calls, one per section, each with a small schema. The LLM returns **raw printed strings**
plus the page number (`{ raw: "(1.2)", page: 2 }`) and never computed values. Document text is wrapped in delimited tags
and declared to be data, not instructions (prompt-injection posture, SPEC-platform).
**Vision fallback:** if a key figure comes back `null` from the text read, or its page has low OCR quality, that
section is re-asked with the **page image** of the relevant pages (corpus trap 2: NAV only in a chart).

**5 Normalize + rules.** Code converts raw strings to schema v1. It detects the decimal and thousands separators per
document from the raw strings, handles `(x)` and `-x` negatives, maps the unit statement to a divisor (`TEUR`→1e3,
`EUR m`→1e6), turns `1.40x` into 1.4 and `14.2%` into 0.142. It then zod-validates and runs
`core/checks/identities.ts`, comparing quarter-on-quarter against the fund's **last posted** extraction (none yet →
the QoQ checks are skipped). Besides the identities, one plausibility check (added 2026-10-11): a company's EBITDA
never exceeds its revenue (`company_ebitda_exceeds_revenue`, catches a lost decimal point, typically from OCR); the
critic can re-read the operating metrics it names.

**6 Critic.** Runs only if checks failed. It receives the failed checks, the fields involved with their raw strings,
and those pages (text, plus image when the field came from vision). For each field it answers `confirmed_as_printed` |
`corrected { raw, page }` | `not_found`. Code applies corrections, re-normalizes and re-checks. **At most 2 rounds.**
The critic is told explicitly not to "repair" a report that is itself inconsistent: if the document prints an
inconsistent TVPI, the right answer is `confirmed_as_printed`, so the flag survives into step 7 as a *source*
inconsistency (corpus trap 1).

### Data (pipeline-owned migrations)
- `pipeline_runs.status` adds `extracted` (pipeline finished, awaiting `confidence`). `needs_triage` is added later by `confidence`.
- `extractions`: run_id, round (0 = first pass, 1–2 = critic rounds), `raw` jsonb (raw strings + pages + read mode text/vision),
  `extraction` jsonb (schema v1), `checks` jsonb, created_at. **Append-only, one row per round**, so every value
  change is auditable.
- `known_funds`: id, gp_name, fund_name, aliases text[]. Seeded with the 4 known GPs (names only).
- `llm_cache`: key = sha256(model, prompt version, effort, input), response jsonb. Used by record/replay so that CI and
  repeated eval runs cost nothing unless a prompt, model or document changes.

### Versioning and lifecycle
Prompts live in `core/pipeline/prompts/*.ts`, each exporting an `id` and `version`. `pipeline_version` on every run =
code version + prompt versions + model ids. This is the hook `evals` uses for shadow comparison and the eval gate.

## Tech Stack additions (need approval: "ask first: new dependencies")
| Package | Use | Note |
|---|---|---|
| `@anthropic-ai/sdk` | LLM calls | official SDK |
| `pdfjs-dist` | PDF text layer + rendering | Node legacy build |
| `@napi-rs/canvas` | render PDF pages to PNG in functions | prebuilt binary, **spike first** |
| `tesseract.js` | OCR for scans (WASM) | language data cached in `/tmp`, **spike first** |
| `exceljs` | XLSX parsing (also used by corpus C6) | |

## Commands
Unchanged from SPEC-platform, plus:
```
Run one doc locally:   node scripts/run-pipeline.ts <document-id> [--replay]   # costs money without --replay
Record fixtures:       node scripts/run-pipeline.ts <document-id> --record     # writes tests/fixtures/llm/*
```

## Project Structure (additions)
```
core/pipeline/           → run.ts (orchestration), classify.ts, parse.ts (interfaces), extract.ts, normalize.ts, critic.ts
core/pipeline/prompts/   → one file per prompt, versioned
netlify/lib/             → anthropic-llm.ts, pdf.ts (pdf.js + canvas), ocr.ts, xlsx.ts, run-store.ts
netlify/functions/       → runs.ts (POST/GET), run-pipeline-background.ts
src/pages/run.tsx        → live run view
tests/core/pipeline/     → unit tests with fake LlmClient
tests/fixtures/llm/      → recorded LLM responses for replay
```

## Testing Strategy
- **Normalizer (unit, exhaustive):** every corpus number style round-trips (the formatter property test, inverted),
  plus edge cases (`n/a`, `–`, `nm`, footnote markers like `352.4¹`, currency symbols, spaces as separators).
- **Orchestration (unit, fake LLM):** step order, parallel sections, vision fallback trigger, critic loop (stops on pass,
  never more than 2 rounds, applies corrections, keeps `confirmed_as_printed`), budget refusal, failure → `failed` with error,
  one audit event per step.
- **Parsing (integration, local files):** text layer of the Alpenrose PDFs contains every labeled value on its page.
  The scan path returns OCR text containing the key figures (needs C8).
- **Prompts (replay):** recorded real responses for the dev split replay in CI, so prompt and parsing regressions show
  up without spending money. Recording is a manual, budgeted step.
- **Live acceptance (manual, budgeted):** run the 3 Alpenrose dev docs end to end on the deployed site.
- Never evaluate prompt changes on the held-out split (SPEC-corpus).

## Boundaries
- **Always:** raw string + page for every value; code (not the LLM) does all arithmetic and unit handling; budget check
  before every LLM call; usage row after every LLM call; document text treated as data.
- **Ask first:** each new dependency above (approve via this spec), changing schema v1, raising the budget, any change
  that sends a document to a service other than Anthropic.
- **Never:** read labels or `corpus_meta` in the pipeline; let the LLM output computed ratios or normalized numbers;
  let the critic overwrite a value without a raw string and page; retry LLM calls without a bound.

## Success Criteria
1. `POST /api/runs` returns 202 with a run id. The Run page shows steps 2→6 appear live and ends in `extracted` or `failed`.
2. On the 3 Alpenrose PDFs, every key figure and every company total value equals the label after normalization (100%).
3. Every extracted value carries its raw string and page, and the page matches the label's `source.page`.
4. Trap 1 (inconsistent TVPI, once C7 lands): the critic confirms as printed and `tvpi_inconsistent` is still failed after round 2.
5. Trap 2 (chart-only NAV): NAV is filled via the vision fallback and marked `read: vision`.
6. The unknown GP (Tessera) is extracted but marked `gp_status: unknown`.
7. Replay tests run in CI with zero API calls; the full test suite stays under 30 s.
8. A run that would exceed the daily budget is refused before any LLM call, and the UI says so.
9. Median wall-clock per native PDF < 90 s; per scan < 4 min.
10. Cost per native-PDF run is recorded and shown on the Run page. Target < $0.40 at the default model.

## Decisions (approved 2026-10-11)
1. **Models:** Opus 5.5 is the default for every step. Cheaper models (Sonnet 5.5, Haiku 5.5) are adopted per step only
   when the eval shows they hold 100% key-figure accuracy on the dev split. The decision and its evidence get recorded
   in an ADR.
   *Applied 2026-10-11 (product owner):* the first shadow experiment (`evals/shadow/2026-10-11-summary.md`) found
   Sonnet 5.5 equal on every gated metric for classify, extract and read B at about half the cost, so those three steps
   run on `claude-sonnet-5-5`; the critic stays on `claude-opus-5-5` (too few calls on the dev split to judge). The
   per-step table is `core/pipeline/models.ts` (`pipeline@0.12.0`).
2. **Page rendering:** spike pdf.js + `@napi-rs/canvas` inside a Netlify function first. Fall back to rendering at ingest
   (browser pdf.js for uploads, `pdftoppm` for the corpus) if the spike fails.
3. **OCR:** `tesseract.js`, so read A stays text-based for every format and read B (vision) stays independent.
4. **Unknown GP:** extract a draft and force triage.
5. **XLSX read B:** a deterministic, label-anchored cell lookup, specified in `SPEC-confidence`. The parser keeps cell
   coordinates (A1 references) for it.
