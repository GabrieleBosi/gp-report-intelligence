# Tasks: platform + corpus

Plan: [plan.md](plan.md) · Specs: [platform](../SPEC-platform.md), [corpus](../SPEC-corpus.md)
Definition of Done for every task: tests pass, typecheck + lint clean, behavior verified, docs updated, one conventional commit.

## Phase 1: Walking skeleton

- [x] **T1: Scaffold the app, the toolchain and CI**
  - Acceptance: Vite+React+TS (strict) app shell renders; `core/` exists with one pure function + test; ESLint (max-warnings 0), Vitest with coverage, `.gitignore`, `.env.example`, `.github/workflows/ci.yml` (install → typecheck → lint → test → build).
  - Verify: `npm ci && npm run typecheck && npm run lint && npm test && npm run build` all pass locally.
  - Deps: none · Files: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `src/main.tsx`, `core/`, `.github/workflows/ci.yml` · Size: M

- [x] **T2: Create the private GitHub repo and get CI green**
  - Acceptance: the private repository exists; specs, plan and T1 are pushed to `main`; CI passes.
  - Verify: `gh repo view --json visibility` → PRIVATE; `gh run list -L1` → success.
  - Deps: T1 · Files: none (git/gh only) · Size: XS

- [x] **T3: Netlify site with a health endpoint and security headers**
  - Acceptance: site linked to the repo, `main` auto-deploys, PRs get previews; `netlify.toml` pins Node 22 and sets CSP/XFO/Referrer headers; `GET /api/health` returns version + key presence (DB checks added in T4); one background function proven to run on a deploy preview; **you enable password protection** (production + previews).
  - Verify: unit test for `checkHealth`; `curl -I <site>` shows the password gate; with the cookie, `/api/health` → 200.
  - Deps: T2 · Files: `netlify.toml`, `netlify/functions/health.ts`, `netlify/functions/ping-background.ts`, `core/health.ts`, `tests/core/health.test.ts` · Size: M

- [x] **T4: Supabase project with migrations, RLS and an append-only audit log**
  - Acceptance: project created (Zurich if available); migration creates `documents`, `pipeline_runs`, `audit_events` (mutation-blocking trigger), `usage_ledger`; RLS on with no policies; private bucket `raw-reports`; env vars set in Netlify; `/api/health` reports db + storage ok.
  - Verify: `npx supabase db push` on an empty project succeeds; SQL `update audit_events …` errors; an anon-key `select` returns nothing; health → all ok on production.
  - Deps: T3 · Files: `supabase/migrations/0001_platform.sql`, `core/health.ts`, `netlify/functions/_deps.ts`, `docs/adr/0001…0003` · Size: M

### Checkpoint: Walking skeleton
- [x] CI green on `main` · [x] password gate works on production + previews · [x] `/api/health` all ok (db, storage, key) · [x] no secrets in repo or history · [x] **Review with Gabriele** (approved 2026-10-10)

## Phase 2: First vertical slice (Alpenrose report goes from generation to the live site)

- [x] **C1: Canonical schema v1**
  - Acceptance: `core/schema.ts` defines classification, fund key figures (with `source.page`), portfolio companies, qualitative fields, the `KEY_FIGURES` list and the label envelope (`docId, split, format, expected, expected_flags, expected_route`).
  - Verify: `npx vitest run tests/core/schema.test.ts` (accepts a valid fixture, rejects missing currency, bad date, negative commitment).
  - Deps: T1 · Files: `core/schema.ts`, `tests/core/schema.test.ts` · Size: S

- [x] **C2: Seeded fund generator and the financial identities**
  - Acceptance: given a seed and a GP profile, the generator produces a consistent fund over 3 quarters; `core/checks/identities.ts` implements TVPI=DPI+RVPI (±0.01), Σ company value≈NAV (1%), paid_in≤commitment, QoQ plausibility; generator output passes every identity.
  - Verify: `npx vitest run tests/core/identities.test.ts tests/corpus/generator.test.ts` (including property-style tests over 50 seeds, and one hand-built inconsistent fund that fails exactly one identity).
  - Deps: C1 · Files: `core/checks/identities.ts`, `corpus/generator/model.ts`, `corpus/generator/profiles.ts`, 2 test files · Size: M

- [x] **C3: Alpenrose PDF renderer, labels and corpus verify**
  - Acceptance: `npm run corpus:generate` writes 3 Alpenrose quarterly PDFs (tables + narrative, "Fictional" footer) and matching labels; `npm run corpus:verify` validates labels, identities and byte determinism.
  - Verify: `npm run corpus:generate && npm run corpus:verify`; `pdftotext` on one PDF shows NAV and TVPI as labeled; regenerate → `git diff --stat corpus/` is empty.
  - Deps: C2 · Files: `corpus/generator/render-pdf.ts`, `corpus/generator/index.ts`, `corpus/verify.ts`, `tests/corpus/determinism.test.ts`, `package.json` · Size: M

- [x] **C4: Seed the corpus and list the documents on the site**
  - Acceptance: `npm run corpus:seed` uploads docs to `raw-reports` and upserts `documents` (by sha256, idempotent); `GET /api/documents` lists them; the app shows a Documents page (name, GP, period, format, source badge).
  - Verify: run seed twice → still 3 rows; function test with fake deps; production site lists 3 Alpenrose reports.
  - Deps: C3, T4 · Files: `corpus/seed.ts`, `netlify/functions/documents.ts`, `src/pages/documents.tsx`, `src/lib/api.ts`, `tests/functions/documents.test.ts` · Size: M

### Checkpoint: First slice
- [x] All tests pass · [x] Alpenrose reports visible on the live site · [ ] **`SPEC-pipeline` can now start in parallel**

## Phase 3: Breadth and uploads

- [x] **C5: Harbourline and Nordkap renderers**: USD m with `(negatives)`; EU number format `1.234,5`, landscape tables.
  - Verify: corpus:verify passes; `pdftotext` shows parentheses / EU format literally while labels hold normalized values.
  - Deps: C3 · Files: `corpus/generator/render-pdf.ts`, `profiles.ts`, tests · Size: S

- [x] **C6: Meridian XLSX capital account plus cover letter (as a sheet)**
  - Verify: corpus:verify; XLSX opens in LibreOffice; byte determinism holds (fixed workbook dates).
  - Deps: C3 · Files: `corpus/generator/render-xlsx.ts`, `profiles.ts`, tests · Size: S

- [x] **C7: Traps 1–3 and the Tessera unknown GP**
  - Acceptance: TVPI inconsistency, chart-only NAV (raster image, absent from the text layer), restatement footnote, Tessera unseen layout; each label carries `expected_flags` + `expected_route`.
  - Verify: corpus:verify asserts each trap fails *exactly* its declared identity; `pdftotext` on trap 2 lacks the NAV value.
  - Deps: C5 · Files: `corpus/generator/traps.ts`, `render-pdf.ts`, `profiles.ts`, tests · Size: M

- [x] **C8: Scanned variants (2, one of them of trap 1)**
  - Verify: `pdftotext` returns ~empty; visually legible at 150 dpi; labels valid; excluded from the byte check.
  - Deps: C7 · Files: `corpus/generator/scan.ts`, `index.ts` · Size: S

- [x] **C9: Finalize the 18-doc split and write the corpus README**
  - Acceptance: 12 dev / 6 held-out as specified; all 4 confidence branches covered by `expected_route` + flags; README explains each doc in < 2 min of reading.
  - Verify: corpus:verify prints the coverage table (format × GP × branch × split); re-seed → 18 rows.
  - Deps: C6, C8 · Files: `corpus/README.md`, `corpus/verify.ts` · Size: S

- [x] **P12b: Classify scans from the page-1 image as well as the OCR text** (decision 2026-10-11, error analysis `2026-10-11-ocr-fund-names`)
  - Acceptance: when page 1 was OCR'd, classify uses `classify-scan@1` with the page-1 image (130 dpi, stable id); text documents keep `classify@1` unchanged; both dev scans classify exactly and route as labeled (trap scan → review, Nordkap scan → auto_post).
  - Verify: unit test on the request; replay of classify + confidence on the dev scans; live run of one scan.
  - Deps: P12 · Files: `core/pipeline/prompts/classify.ts`, `core/pipeline/classify.ts`, function wiring, fixtures · Size: S

## Review fixes (code review + security audit of 9647e1d..aa54297, 2026-10-11)

- [x] **R1: Spreadsheet number formats rendered as Excel shows them**
  - Acceptance: table-driven test of real GP formats: accounting `_(* #,##0_);_(* (#,##0);_(* "-"??_);_(@_)`, `#,##0_);(#,##0)`, `[Red]`/`[$€-2]` blocks, trailing-comma scaling (`#,##0,,"m"`), zero section, percent, multiples, dates; sign never inverted, no section mistaken for a date.
  - Deps: P12 · Files: `netlify/lib/xlsx.ts`, `tests/netlify/xlsx.test.ts` · Size: S

- [x] **R2: Linear, budgeted XLSX reader**
  - Acceptance: no regex backtracking on unclosed tags (indexOf scanner); each part inflated once against one shared budget of actual bytes; caps on sheets, cells and output characters with a clear "workbook too large" error; bounded code points, decimals and date serials.
  - Verify: crafted-workbook tests (unclosed cells, 2,000 sheets on one part, shared-string amplification) each finish < 1 s or are rejected.
  - Deps: R1 · Files: `netlify/lib/xlsx.ts`, tests · Size: M

- [x] **R3: One filtered raw everywhere; non-vacuous replay tests; one operating-metric join**
  - Acceptance: the blank-row filter result is what ctx, the stored row, critic, compare and assess all index; a leading blank row test; replay tests assert document counts and routes unconditionally; normalize and critic share one name join (duplicates → issue).
  - Deps: P12 · Files: `core/pipeline/normalize-step.ts`, `critic.ts`, tests · Size: S

- [x] **R4: PDF page and size caps, OCR worker lifecycle, escaped page text** (before uploads)
  - Acceptance: page cap and OCR-page cap; render scale clamped to ~16 MP; OCR worker closed at the end of parse and close errors never throw from `finally`; `</page`/`</document` neutralised in page text.
  - Deps: P12 · Files: `core/pipeline/parse.ts`, `netlify/lib/pdf.ts`, `netlify/lib/ocr.ts`, prompts, function · Size: M
  - Note: per-run input cap + pre-call cost estimate and the upload fund cross-check belong to T5.

- [x] **T5: Upload guardrails in `core/`**
  - Acceptance: pure validators for magic bytes (PDF/XLSX), ≤ 10 MB, ≤ 20 pages, hourly rate (30), sha256 dedupe, daily budget (`DAILY_LLM_BUDGET_USD`=15), each returning a typed result with a user-facing message.
  - Verify: `npx vitest run tests/core/guardrails.test.ts` (12 MB file, renamed `.exe`, 21-page PDF, 31st upload, budget reached, duplicate).
  - Deps: T1 · Files: `core/guardrails.ts`, `tests/core/guardrails.test.ts` · Size: S

- [x] **T6: Upload function and UI**
  - Acceptance: `POST /api/upload` applies T5, stores the raw file, inserts `documents` (source=`upload`) and an `audit_events` step-1 row; the UI shows progress and clear rejections.
  - Verify: function tests with fake deps for accept + each rejection; manual upload on a deploy preview → row and audit event in Supabase.
  - Deps: T5, C4 · Files: `netlify/functions/upload.ts`, `src/components/upload.tsx`, `src/pages/documents.tsx`, `tests/functions/upload.test.ts` · Size: M

- [x] **T7: Playwright smoke test**
  - Acceptance: against `netlify dev`: shell loads, Documents page lists the corpus, `/api/health` ok. Runs locally (not in CI, since it needs secrets).
  - Verify: `npm run test:e2e`.
  - Deps: T6 · Files: `playwright.config.ts`, `e2e/smoke.spec.ts` · Size: S

### Checkpoint: platform + corpus complete
- [ ] Every success criterion in SPEC-platform (1–7) and SPEC-corpus (1–5) checked with evidence
- [ ] Code review pass (`code-review-and-quality`) + security pass on upload/RLS (`security-and-hardening`)
- [ ] **Review with Gabriele → write SPEC-pipeline**

---

# Tasks: pipeline

Plan: [plan-pipeline.md](plan-pipeline.md) · Spec: [pipeline](../SPEC-pipeline.md)
**Execution order across both lists:** P1, P2 → P9 → P3 → P4 → P5 → P6 → P7 → P8 → C5, C7 → P10 → P11 → C6, C8, C9 → P12 → T5, T6 → P13 → T7

## Phase P-1: Spikes (risk first)

- [x] **P1: Spike: render a PDF page to PNG inside a deployed Netlify function** (GO, ADR-0004)
  - Acceptance: a background function loads an Alpenrose PDF from storage, renders page 2 at 150 dpi with pdfjs-dist + @napi-rs/canvas, and stores `pages/<sha256>/p2.png`. Time and bundle size are recorded in ADR-0004 with a go/no-go. On no-go, the ADR records the fallback (render at ingest).
  - Verify: function logs show the timing; the stored PNG opens and shows the portfolio table; `npm run build` passes.
  - Deps: none · Files: `netlify/lib/pdf.ts`, `netlify/functions/spike-render-background.ts` (deleted after P11), `netlify.toml`, `docs/adr/0004-page-rendering.md` · Size: M

- [x] **P2: Spike: OCR a rendered page with tesseract.js inside a function** (GO, ADR-0004)
  - Acceptance: OCR of the P1 PNG returns text containing the page's company total values; time, memory and language-data caching (`/tmp`) are recorded in ADR-0004.
  - Verify: function log shows the OCR text and timing.
  - Deps: P1 · Files: `netlify/lib/ocr.ts`, spike function, ADR-0004 · Size: S

### Checkpoint: spikes
- [x] Go/no-go recorded for rendering and OCR (both GO) · [x] fallback not needed · [x] **Tell Gabriele the outcome**

## Phase P-2: Step 5 core and the LLM port

- [x] **P9: Normalizer: raw printed strings → schema v1 values**
  - Acceptance: `normalizeAmount(raw, unitStatement, separators)`, separator detection per document, `(x)`/`-x` negatives, unit statements (`EUR m`, `USD in millions`, `TEUR`, `CHF k`, `in thousands`), `1.40x`, `14.2%`, `n/a`/`–`/`nm` → null, footnote markers stripped. Every corpus style round-trips (inverse of the formatter property test).
  - Verify: `npx vitest run tests/core/pipeline/normalize.test.ts`
  - Deps: none · Files: `core/pipeline/normalize.ts`, its test · Size: M

- [x] **P3: LlmClient port with Anthropic, replay and record implementations, plus cost accounting**
  - Acceptance: `core/llm.ts` port (structured output against a zod schema, effort, images); Anthropic adapter (Opus 5.5, `output_config.format`, `fallbacks: "default"`, refusal → typed error); replay adapter (fixture miss → explicit error naming the key); `core/pricing.ts` cost per call; budget guard reads today's `usage_ledger`.
  - Verify: unit tests for cost, budget refusal, replay hit/miss; one live call (classify on Alpenrose text) records a fixture; its cost is logged and reported.
  - Deps: none · Files: `core/llm.ts`, `core/pricing.ts`, `netlify/lib/anthropic-llm.ts`, `netlify/lib/replay-llm.ts`, tests · Size: M

## Phase P-3: A run, end to end

- [x] **P4: Run lifecycle API**
  - Acceptance: migration (status `extracted`, `extractions`, `known_funds` seeded with 4 GPs, `llm_cache`); `POST /api/runs` → 202 + run id (one active run per document); background function runs `core/pipeline/run.ts` (step list with budget check, audit event, timing, error → `failed`); `GET /api/runs/:id` → status + step timeline.
  - Verify: orchestrator tests with fakes (order, audit per step, failure path, budget refusal); live: POST on an Alpenrose doc → `extracted` with a "load document" step in the audit trail.
  - Deps: P3 · Files: `supabase/migrations/*_pipeline.sql`, `core/pipeline/run.ts`, `netlify/lib/run-store.ts`, `netlify/functions/runs.ts`, `netlify/functions/run-pipeline-background.ts` · Size: L (cohesive; tests alongside)

- [x] **P5: Step 3 parse: PDF text layer per page**
  - Acceptance: `ParsedDocument` with per-page text in reading order and `source: text_layer`; a page with < 50 chars is marked `needs_ocr`.
  - Verify: test on the 3 Alpenrose PDFs: every labeled value's printed string is on its labeled page.
  - Deps: P4 · Files: `core/pipeline/parse.ts`, `netlify/lib/pdf.ts`, test · Size: S

- [x] **P6: Run page**
  - Acceptance: "Run" button on each document; Run page polls `GET /api/runs/:id` and shows a live step timeline (status, duration, cost), then the extraction table (value, raw string, page) when present.
  - Verify: screenshot of a live run on the deployed site; empty, loading and error states render.
  - Deps: P4, P5 · Files: `src/pages/run.tsx`, `src/lib/api.ts`, `src/pages/documents.tsx`, `src/app.tsx` (adds routing) · Size: M

## Phase P-4: LLM steps

- [x] **P7: Step 2 classify + known-fund match**
  - Acceptance: prompt `classify@1` (effort low); code fuzzy-matches against `known_funds`; Tessera → `gp_status: unknown`. The pipeline cannot read `corpus_meta` (lint rule + test).
  - Verify: replay tests on recorded responses for the 3 Alpenrose docs; matcher unit tests (aliases, punctuation, case).
  - Deps: P3, P5 · Files: `core/pipeline/classify.ts`, `core/pipeline/prompts/classify.ts`, fixtures, tests, `eslint.config.js` · Size: M

- [x] **P8: Step 4 extract per section → step 5 normalize + checks** (dev 100% exact incl. live; held-out Q2 portfolio under-extracted once, caught by `nav_bridge_gap`: see docs/error-analysis/2026-10-11-portfolio-under-extraction.md)
  - Acceptance: 4 section prompts (effort medium) run in parallel and return raw strings + pages; normalized into schema v1; identity checks run; `extractions` round-0 row stored.
  - Verify: replay test: all 3 Alpenrose docs match their labels on every key figure and company total (100%); live run on the deployed site matches the same.
  - Deps: P7, P9 · Files: `core/pipeline/extract.ts`, `core/pipeline/prompts/extract-*.ts`, fixtures, tests · Size: M

### Checkpoint: Alpenrose extracted
- [x] Live runs: Q4 2025 and Q1 2026 (dev) exact on every field; Q2 2026 (held-out) fund figures exact, portfolio 1/6 (stochastic, caught by checks, recovery in P10) · [x] cost per run shown (~$0.07, ~14 s) · [x] **Review with Gabriele** (2026-10-11: no tuning on held-out, keep the failed answer cached as a demo case, continue C5 → C7 → P10 → P11)

## Phase P-5: Critic and vision fallback

- [x] **P10: Step 6 critic loop (max 2 rounds)**
  - Acceptance: runs only on failed checks; per field `confirmed_as_printed | corrected | not_found`; corrections re-normalized and re-checked; one `extractions` row per round; stops at pass or after round 2. A failed `nav_bridge_gap` re-extracts the **whole portfolio section** (missing companies have no field paths to re-read). Decide whether answers that fail their checks should be cached.
  - Verify: loop-control unit tests with a fake LLM; replay on trap 1: `tvpi_inconsistent` still failed after the critic, value confirmed as printed.
  - Deps: P8, C7 · Files: `core/pipeline/critic.ts`, `core/pipeline/prompts/critic.ts`, fixtures, tests · Size: M

- [x] **P11: Vision fallback in step 4**
  - Acceptance: a key figure null from the text read (or low OCR quality on its page) → that section is re-asked with page images; the field is marked `read: vision`. The P1 spike function is removed.
  - Verify: replay on trap 2: NAV filled from the chart via vision and equal to the label.
  - Deps: P1, P8, C7 · Files: `core/pipeline/extract.ts`, `netlify/lib/pdf.ts`, fixtures, tests · Size: M

## Phase P-6: Other formats and acceptance

- [x] **P12: OCR path for scans and XLSX parsing**
  - Acceptance: scanned PDFs → OCR text per page with quality; XLSX → one page per sheet as a cell grid with A1 refs; both feed the same extract step.
  - Verify: replay on the 2 scans and the Meridian XLSX: key figures match their labels (scans: report the accuracy honestly if below 100%).
  - Deps: P2, C6, C8 · Files: `core/pipeline/parse.ts`, `netlify/lib/ocr.ts`, `netlify/lib/xlsx.ts`, fixtures, tests · Size: M

- [x] **P13: Live acceptance, cost and latency**
  - Acceptance: every SPEC-pipeline success criterion (1–10) checked with evidence; the cost and latency per document are recorded in the Run page and summarized in `docs/pipeline-acceptance.md`.
  - Verify: `scripts/verify-deploy.sh` extended with a replayed run; manual live run of every dev-split document.
  - Deps: P10, P11, P12, T6 · Files: `docs/pipeline-acceptance.md`, `scripts/verify-deploy.sh` · Size: S

### Checkpoint: pipeline complete
- [ ] All SPEC-pipeline success criteria met with evidence · [ ] code review + security pass (prompt injection, upload → pipeline path) · [ ] **Review with Gabriele → confidence**

---

# Tasks: confidence

Plan: [plan-confidence.md](plan-confidence.md) · Spec: [confidence](../SPEC-confidence.md)
**Execution order:** K1 → K2 → K3 → K4 → K5, then C6 → C8 → C9 → P12 → K6 → T5 → T6 → P13 → T7

- [x] **K1: Policy, comparison and assessment (pure core)**
  - Acceptance: `policy@1` (key figures, ratio tolerance 0.005, footnote markers, routing rules); `compare` normalizes read B with the document's unit statement and separators and aligns companies by name; `assess` implements every row of the matrix and every not-high case with plain-language reasons, document level = minimum, route triage / auto_post / review.
  - Verify: table-driven unit tests, one per matrix row and per not-high case; routing tests; `npx vitest run tests/core/confidence`.
  - Deps: none · Files: `core/confidence/policy.ts`, `core/confidence/compare.ts`, `core/confidence/assess.ts`, tests · Size: M

- [x] **K2: Read B, the confidence step, and final run status**
  - Acceptance: `read-b@1` over images of the pages where read A found the key figures (130 dpi, stable image ids); request contains no read-A value; the step runs read B, assesses, appends an `assessments` row (policy version, round, per-field evidence) and sets `ctx.finalStatus`; migration adds `needs_triage`, `ready_to_post` and the append-only `assessments` table; the run engine finishes with the step's status.
  - Verify: unit tests with a fake LLM (independence guard, triage without a read-B call, stored evidence, final status); SQL contract test; `npm test`.
  - Deps: K1 · Files: `core/pipeline/prompts/read-b.ts`, `core/pipeline/confidence-step.ts`, `core/pipeline/run.ts`, `netlify/lib/run-store.ts`, `supabase/migrations/*_confidence.sql` · Size: M

- [x] **K3: Proof on the dev corpus (replay)**
  - Acceptance: read-B fixtures recorded for all dev documents; replay: every dev document's route equals its `expected_route`, with the expected reasons for the TVPI misprint (source inconsistency) and chart NAV (vision fallback); safety property: a document whose extraction differs from its label is never `auto_post`.
  - Verify: `npx vitest run tests/core/pipeline/confidence-replay.test.ts`; CI green.
  - Deps: K2 · Files: tests, fixtures, `scripts/record-fixtures.ts`, `netlify/functions/run-pipeline-background.ts` · Size: M

- [x] **K4: Confidence on the Run page**
  - Acceptance: route banner (auto-post / review / triage) with the reasons; per key figure: value A, value B, checks, level, reason; the run view returns the latest assessment.
  - Verify: unit test for the view mapping; screenshots of an auto-post run, the TVPI misprint and the chart NAV.
  - Deps: K2 · Files: `core/pipeline/run-view.ts`, `netlify/lib/run-store.ts`, `src/components/confidence-panel.tsx`, `src/pages/run.tsx` · Size: M

- [x] **K5: Live acceptance, held-out measurement, ADR**
  - Acceptance: SPEC-confidence success criteria 1–7 checked with evidence; held-out measured once (Tessera, restatement, three Q2 documents) and reported as is; ADR-0005 (confidence policy, independence, footnote rule trade-off).
  - Verify: live runs on the deployed site; `docs/confidence-acceptance.md`.
  - Deps: K3, K4 · Files: `docs/adr/0005-confidence-policy.md`, `docs/confidence-acceptance.md` · Size: S

- [x] **K6: XLSX read B (label-anchored cell lookup)**
  - Acceptance: for spreadsheets, read B finds each key figure's label cell ("Net asset value", synonyms from the vocabulary) and takes the adjacent number; same comparison and matrix; no LLM call.
  - Verify: unit tests on the Meridian XLSX; replay route for the Meridian dev documents.
  - Deps: P12, K2 · Files: `core/confidence/xlsx-read-b.ts`, tests · Size: S

### Checkpoint: confidence complete
- [ ] Dev routes match labels · [ ] safety property holds · [ ] held-out measured · [ ] **Review with Gabriele**

## Review (SPEC-review, plan: tasks/plan-review.md)

- [x] **V1: Review rules (pure core)**
  - Acceptance: transition table (`needs_review` → `approved` | `rejected`; `needs_triage` → `needs_review` | `rejected`; everything else refused); approval needs a reason exactly when a check still fails; rejection always needs a reason; a correction (raw value + page) re-runs `normalizeRaw` and the checks and returns the new extraction, checks and assessment-relevant state; triage assignment only to a registry fund.
  - Verify: `npx vitest run tests/core/review` (one test per table row).
  - Deps: K2 · Files: `core/review/actions.ts`, `core/review/queue.ts`, tests · Size: M

- [x] **V2: Migration and review store**
  - Acceptance: status `approved`; append-only `review_decisions` (kind, field, before/after, reason, analyst, policy); a database trigger enforcing the transition table; `extractions` accepts analyst rounds (`source`, round ≥ 3); RLS deny-all, no anon access.
  - Verify: `supabase/tests/review.sql` passes live; store unit tests with fakes.
  - Deps: V1 · Files: `supabase/migrations/*_review.sql`, `supabase/tests/review.sql`, `netlify/lib/review-store.ts` · Size: M

- [x] **V3: Source page image**
  - Acceptance: `GET /api/runs/:id/pages/:n` returns the page PNG (130 dpi), cached in `page-images`; 404 for a page outside the document; workbooks get the sheet as text instead (no image).
  - Verify: function test with fakes; cold and warm timings on the deployed site (< 3 s cold).
  - Deps: P11 · Files: `netlify/functions/page-image.ts`, `src/components/source-page.tsx` · Size: S

- [x] **V4: Review API**
  - Acceptance: `GET /api/review/queue`; `POST /api/runs/:id/review` with `accept_field` | `correct` | `approve` | `reject` | `assign_fund`, zod-validated, applying V1 and storing via V2; 400 for a missing reason, 409 for a forbidden transition; the run view includes decisions.
  - Verify: function tests with fakes for every action and refusal.
  - Deps: V1, V2 · Files: `netlify/functions/review.ts`, `core/pipeline/run-view.ts`, tests · Size: M

- [x] **V5: Queue and review screen**
  - Acceptance: `/review` queue with counts and reasons; review mode on the Run page: source page beside the figures (low first), accept / correct per figure with checks updating, approve / reject with reason, triage fund picker, analyst name asked once.
  - Verify: component-level tests for the decision rules shown in the UI; screenshots of trap 1 and Tessera.
  - Deps: V3, V4 · Files: `src/pages/review-queue.tsx`, `src/components/review-panel.tsx`, `src/app.tsx` · Size: M

- [x] **V6: E2E and live acceptance**
  - Acceptance: Playwright: trap 1 from the queue → page image → approve with reason → `approved`; every SPEC-review success criterion checked with evidence in `docs/acceptance/<date>-review.md`.
  - Deps: V5 · Files: `e2e/review.spec.ts`, docs · Size: S

### Checkpoint: review complete
- [ ] Trap 1 approved with a reason · [ ] a correction stored as a round and a decision · [ ] forbidden transitions refused by API and DB · [ ] **Review with Gabriele**

## Posting (SPEC-posting, plan: tasks/plan-posting.md)

- [x] **S1: Record and posting rules (pure core)**
  - Acceptance: the record is built from the latest extraction round (analyst corrections included) with identity, figures and provenance (run, sha256, pipeline and policy versions, auto_post or analyst + reason); validation (known fund, period, currency, six fund key figures); `postRun` posts only `ready_to_post` / `approved`, logs every attempt, sets `posted` on success, keeps the status and logs on an outage, does not retry a 422, reports `unchanged` and duplicates idempotently.
  - Verify: `npx vitest run tests/core/posting` with a fake portfolio system that can fail.
  - Deps: V1 · Files: `core/posting/record.ts`, `core/posting/post.ts`, tests · Size: M

- [x] **S2: Mock portfolio system and posting log**
  - Acceptance: append-only `portfolio_records` (fund + period, version, payload, superseded) and `postings` (attempts); one SQL function posts atomically (idempotency by run id, unchanged detection, supersede); RLS deny-all.
  - Verify: `supabase/tests/posting.sql` passes live; adapter mapping tests.
  - Deps: S1 · Files: `supabase/migrations/*_posting.sql`, `supabase/tests/posting.sql`, `netlify/lib/portfolio-system.ts` · Size: M

- [x] **S3: Wiring: auto-post, on approval, retry**
  - Acceptance: the pipeline posts a `ready_to_post` run after step 7 (a posting failure never fails the run); the review API posts on approval; `POST /api/runs/:id/post` retries; every path goes through `postRun`.
  - Verify: function tests with fakes; a live clean dev run ends `posted`.
  - Deps: S2 · Files: `netlify/functions/run-pipeline-background.ts`, `review.ts`, `post.ts` · Size: M

- [x] **S4: Posting on the Run page and the portfolio page**
  - Acceptance: Run page shows the posting (record, version, cleared by, attempts) and Retry posting when the last attempt failed; `/portfolio` lists current records with their history.
  - Deps: S3 · Files: `src/components/posting-panel.tsx`, `src/pages/portfolio.tsx`, `netlify/functions/portfolio.ts` · Size: S

- [x] **S5: E2E and live acceptance**
  - Acceptance: Playwright: clean report → posted → visible on the portfolio page; trap 1 approved → posted with the reason in provenance; every SPEC-posting success criterion with evidence in `docs/acceptance/<date>-posting.md`.
  - Deps: S4 · Files: `e2e/posting.spec.ts`, docs · Size: S

### Checkpoint: posting complete
- [ ] Clean run posted with no human · [ ] approval posts · [ ] retries idempotent · [ ] **Review with Gabriele**

## Evals (SPEC-evals, plan: tasks/plan-evals.md)

- [x] **E1: Metrics and first-bad-step attribution (pure)**
  - Acceptance: key-figure / all-figure / classification / route accuracy and unsafe auto-posts per document and in total; each wrong value attributed to step 2, 3, 4, 5, 6 or 7 per the SPEC-evals table; gate comparison against a baseline (pass, regression, unsafe > 0).
  - Verify: `npx vitest run tests/core/evals` (one test per metric and per attribution row).
  - Deps: none · Files: `core/evals/metrics.ts`, `core/evals/first-bad-step.ts`, `core/evals/gate.ts`, tests · Size: M

- [x] **E2: Golden set and harvest**
  - Acceptance: `npm run eval:harvest` builds `evals/golden.json` from the labels and the analyst corrections in the database; corrections that disagree with a corpus label are listed; the file is committed.
  - Deps: E1 · Files: `scripts/eval-harvest.ts`, `evals/golden.json` · Size: S

- [x] **E3: Eval runner, report, baseline**
  - Acceptance: `npm run eval` replays the dev split through steps 2-7 ($0, < 2 min), writes `evals/reports/<date>-<version>.{json,md}` with metrics, errors by first bad step and cost, compares with `evals/baseline.json` and exits non-zero on a gate failure; the first baseline is committed.
  - Deps: E1, E2 · Files: `scripts/eval.ts`, `evals/baseline.json`, `evals/reports/` · Size: M

- [x] **E4: CI eval gate**
  - Acceptance: a CI job runs `npm run eval` on every push; a deliberately broken normalizer makes it fail and reverting makes it pass (shown on a branch, then dropped).
  - Deps: E3 · Files: `.github/workflows/ci.yml` · Size: S

- [x] **E5: Shadow runs and the first experiment**
  - Acceptance: `npm run eval:shadow -- --step <step> --model <model>` re-runs the dev split with one step on the candidate (budget-guarded, recorded), and writes a side-by-side report; Sonnet 5.5 measured on each LLM step; a recommendation per step following SPEC-pipeline decision 1.
  - Deps: E3 · Files: `scripts/eval-shadow.ts`, `core/pipeline/models.ts`, reports · Size: M

- [x] **E6: Held-out on demand and acceptance**
  - Acceptance: `npm run eval:live -- --split heldout` re-measures held-out on the live site and reports as is; every SPEC-evals success criterion with evidence in `docs/acceptance/<date>-evals.md`.
  - Deps: E4, E5 · Files: `scripts/eval.ts`, docs · Size: S

### Checkpoint: evals complete
- [ ] Gate proven to fail on a regression · [ ] first experiment reported · [ ] **Review with Gabriele**

## Showcase (SPEC-showcase, plan: tasks/plan-showcase.md)

- [x] **H1: Content, demo runs and the decisions parser**
  - Acceptance: `src/showcase/content.ts` holds the sketch steps (what, who, requirement, choice, spec section, tests, demo run), the requirement → choice table and the three tour scripts; a stable demo run set is chosen and recorded; `src/showcase/decisions.ts` parses every spec's "Decisions" section.
  - Verify: unit tests: every link resolves (routes, spec headings, documents, run ids in the demo set); decision count per spec.
  - Deps: none · Files: `src/showcase/content.ts`, `src/showcase/decisions.ts`, tests · Size: M

- [x] **H2: Overview with the interactive sketch** (`/about`)
  - Acceptance: the sketch's 9 steps and the improvement loop as an accessible diagram; each opens a panel with evidence links.
  - Deps: H1 · Files: `src/pages/about.tsx`, `src/components/sketch-diagram.tsx` · Size: M

- [x] **H3: Demo tour** (`/tour`)
  - Acceptance: three scenarios (clean auto-post; trap 1 review → post; the improvement loop), each a numbered sequence into the live app.
  - Deps: H1 · Files: `src/pages/tour.tsx` · Size: S

- [x] **H4: Evals page** (`/evals`)
  - Acceptance: latest eval report and baseline, errors by first bad step, held-out results, shadow summary, gate proof, the improvement-loop timeline; all dated.
  - Deps: H1 · Files: `src/pages/evals.tsx` · Size: M

- [x] **H5: Decisions page** (`/decisions`)
  - Acceptance: every parsed decision (date, module, choice, evidence) and the requirement → choice table.
  - Deps: H1 · Files: `src/pages/decisions.tsx` · Size: S

- [x] **H6: Document viewer and build facts** (`/process`)
  - Acceptance: every spec, plan, task list, ADR, error analysis and acceptance report rendered in-app with `marked`; `npm run showcase:facts` writes `src/generated/build-facts.json`.
  - Deps: H1 · Files: `src/pages/process.tsx`, `src/components/doc-viewer.tsx`, `scripts/showcase-facts.ts` · Size: M

- [x] **H7: Live operating numbers**
  - Acceptance: `GET /api/metrics` (documents, runs by route, review decisions, postings, LLM spend; aggregates only) shown on the evals page.
  - Deps: H4 · Files: `netlify/functions/metrics.ts`, `core/showcase/metrics.ts` · Size: S

- [x] **H8: E2E, visual checks and acceptance**
  - Acceptance: Playwright over every showcase page and tour link; screenshots at 1280×720 and 390 px; every SPEC-showcase criterion with evidence.
  - Deps: H2-H7 · Files: `e2e/showcase.spec.ts`, docs · Size: S

### Checkpoint: showcase complete
- [ ] Tour walked in < 10 minutes · [ ] every claim links to evidence · [ ] **Review with Gabriele**, then freeze

## Public release (SPEC-public-release, plan: tasks/plan-public-release.md)

- [x] **T1: Baseline** · Acceptance: suite and eval green in the working copy; counts recorded · Size: S · Done 2026-11-14: typecheck, lint, 590/590 tests (70 files, 98.99% lines), build, eval gate pass (dev split n=12, 0 unsafe auto-posts)
- [x] **T2: Delete demo-day material** · Acceptance: `ops/` and the preflight gone, no reference left, suite green · Size: M · Done: 581/581 tests (the 9 removed were the preflight's), eval gate pass
- [x] **T3: Scrub code, config and tests** · Acceptance: markers grep clean outside `*.md`, suite green · Size: M · Done: clean except 2 lines that assert CAPABILITY-MAP text (moved to T4); 581/581, eval pass
- [x] **T4: Scrub capability map and specs** · Acceptance: markers grep clean on them, decisions test green · Size: M · Done: clean; superseded decisions point to SPEC-public-release; 581/581, eval pass
- [x] **T5: Scrub plans and docs** · Acceptance: markers grep clean over the whole tree · Size: M · Done: tree, fresh dist/ and src/generated clean; private commit refs removed; stale screenshots removed (retaken in T12)

### Checkpoint A: scrub complete
- [ ] Suite and eval green · [ ] grep clean on tree and fresh `dist/` · [ ] **Review wording diff with Gabriele**

- [x] **T6: Access-key gate** · Acceptance: every path answers 401 without the key before any dependency call · Size: M · Done: 11/11 functions wrapped, wiring test proves no other env read; owner scripts use the key; 602/602
- [x] **T7: Held-out answers** · Acceptance: held-out replay evaluates 6/6 with no miss (else ask) · Size: S · Done: 38 answers copied from llm_cache, $0; plain replay 6/6 at pipeline@0.13.0 (0 unsafe, key-figure and route accuracy 100%)
- [x] **T8: Snapshot export** · Acceptance: `npm run snapshot` exports read-only through the API's adapters; output passes the API schemas; markers clean; under 10 MB · Size: M · Done: 18 documents, 56 linked runs, 4 queued, 32 page images, 5.8 MB; contract test 7/7
- [x] **T9: Snapshot reads** · Acceptance: all pages read the snapshot by default; banner; live-only controls disabled · Size: M · Done: checked headless on the static build: no /api/ requests, page image renders, unknown run says it is not in the snapshot
- [x] **T10: Review and posting in the browser** · Acceptance: same outcome as `decide()` per queued run; reload resets · Size: M · Done: server code against in-memory mirrors of 3 SQL functions; checked through the UI on the static build (approve, posted, queue, portfolio, reload), no /api/ request
- [x] **T11: Owner access** · Acceptance: key sent on every live call; wrong key shows the 401 message · Size: S · Done: key verified against /api/health before it is kept; live page images fetched with the key into blob: URLs; checked headless against a stand-in API
- [x] **T12: Links and e2e** · Acceptance: static build, no `/api/*` requests, fix-and-post works · Size: M · Done: `npm run test:e2e:snapshot` (vite preview, no functions) 5/5: every page, tour step and evidence link renders; a visitor corrects the chart-read NAV, approves, the record joins the portfolio, a reload undoes it; any /api/ request fails the test (probed); tour and evals wording says recorded, not live; layout test and the 12 screenshots moved to the public site; live specs run as the owner (`e2e/live.ts`, LIVE_ACCESS_KEY from .env, not run: the key is not set yet)

### Checkpoint B: public mode complete
- [ ] Suite, eval, e2e green · [ ] **Gabriele looks at the local site**

- [x] **T13: ADR-0006 and spec updates** · Size: S · Done: ADR-0006 (alternatives limited to those weighed); SPEC-platform access and criteria 2-3 marked superseded; `public-release` in the capability map, its 5 decisions on the decisions page (44 in all); runs.ts comment; stale answers to open questions 1 and 3 in SPEC-public-release corrected
- [x] **T14: README and licence** · Acceptance: spec's sections in order; n and split on every number; style greps clean · Size: M · Done: README in the spec's order (GIF added in T17), checked by tests/docs/readme.test.ts (sections, mermaid diagram, n and split on every score, no em dash or banned word, every link resolves); MIT LICENSE; `npm run eval:heldout` so the held-out column is reproducible ($0, prints only); process page names Claude Code and no longer calls the repository private
- [x] **T15: Build facts from the archive** · Size: S · Done: `npm run showcase:facts -- <archive> <owner/repo>` reads commits and CI runs from the archive read-only (path and name are arguments, never written here); 139 commits shown per day, 123 CI runs; tests counted here (656 unit and integration, 27 browser listed by Playwright); the page labels the history as a private archive; the loop timeline's private commit hashes removed; process and decisions screenshots retaken
- [x] **T16: Rate limits, $5 default cap, gitleaks in CI** · Size: S · Done: per-IP limit (6 per 180 s) on upload and run-pipeline-background; `dailyBudgetUsd` defaults to $5 and also when the value is not a positive number (NaN never stopped a call); gitleaks-action v3.0.0 pinned by hash, read-only, a test checks every action is pinned; verify-deploy's deliberately wrong key no longer trips gitleaks · For T19: checkout, setup-node and upload-artifact pins are Node 20 actions (still green in the archive on 26 Oct; gitleaks says GitHub removed Node 20 on 16 Sep): watch the first run · For T21: confirm the rate limit applies to the background function (Netlify documents it for functions, not background ones specifically)
- [x] **T17: Review-screen GIF** · Size: S · Done: `npm run media:review-gif` records the chart-read NAV being checked, corrected, approved and posted on the static build (Chromium screencast frames, system ffmpeg, no download); docs/media/review-fix.gif, 16.5 s, 347 KB; embedded after the problem, with a caption; README test checks it exists, is under 3 MB and sits in place

### Checkpoint C: ready to publish
- [x] Review, simplification and security passes (fresh-context reviewers; findings fixed with tests: snapshot export checks and corpus-only portfolio, in-browser posting grouped by fund id, missing records fail the posting, concurrent decisions, owner access refuses without live functions, budget 0 stops spending, rate limits on every function; accepted: budget overshoot by in-flight calls, key length by timing) · [x] grep and gitleaks clean (tree, dist, src/generated, public; gitleaks flags only the git-ignored .env) · [ ] **Gabriele reads the README** · [x] favicon

- [x] **T18: Squash to one commit (local)** · Size: XS · Done: orphan branch `release`, one commit authored and committed with the noreply address; gitleaks over its history: no leaks; markers grep over the whole commit (no exclusions) and its message: clean
- [x] **T19: Create public repository and push (ask)** · Size: XS · Done: public repo GabrieleBosi/gp-report-intelligence, MIT detected, one commit by the noreply address; first CI run green (verify, eval-gate, secrets: gitleaks scanned 1 commit, no leaks); Node 20 pins only warned, bumped in T20
- [x] **T20: Gate proof on the public repository (ask)** · Size: S · Done: PR #1 red on the eval gate (route accuracy 75.0% < 91.7%; 16 unit tests too), closed unmerged, branch deleted; gate-proof.md links the red run and the green main run; actions bumped to their Node 24 releases (checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2, release notes read: no breaking change for this workflow)
- [ ] **T21: Site: key, relink, rename, remove password, deploy (ask)** · Size: S · Before removing the password: owner rotates the Supabase service key and the Anthropic key and redeploys (old deploys keep their functions and env at their permalinks); old deploys deleted or shown protected, `verify-deploy.sh` checks one; keys scoped to Production; fork PR previews need approval
- [x] **T22: Netlify team plan** · No change: the team stays on Pro (decided at plan approval)
- [ ] **T23: PORTFOLIO-FACTS.md in the private folder** · Size: S

### Checkpoint D: released
- [ ] Every spec success criterion checked with evidence · [ ] **Sign-off by Gabriele**
