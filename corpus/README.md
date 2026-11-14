# Corpus: 18 synthetic GP reports

Every fund, GP, company and number here is **fictional**, generated from a seeded model (`generator/model.ts`); each
page and sheet says so. No real GP document or case-study material was used. Spec: [SPEC-corpus.md](../SPEC-corpus.md).

Each document in `docs/` has a label in `labels/` with the values it **prints** (schema v1), the identity checks it
should fail (`expected_flags`) and the route step 7 should take (`expected_route`).

## The documents
**Five GPs, five ways of printing the same numbers**

| GP | Format | What it tests |
|---|---|---|
| Alpenrose Capital (EUR) | native PDF, `EUR m`, `1,234.5` | the happy path |
| Harbourline Partners (USD) | native PDF, `USD m`, negatives as `(12.3)`, own wording ("Contributed Capital") | sign and vocabulary normalization |
| Nordkap Equity (EUR) | landscape PDF, `TEUR`, European format `1.234,5` | locale normalization |
| Meridian Growth (USD) | **XLSX** workbook: capital account, portfolio with dates, cover letter as sheet 3 | the spreadsheet path |
| Tessera Ventures (CHF) | unseen layout, `CHF k`, `102'800` | an unknown GP must go to triage |

**Regular quarters** (Q4 2025, Q1 2026 in dev; Q2 2026 held out) for Alpenrose, Harbourline, Nordkap and Meridian:
12 documents, all expected to be posted automatically.

**Designed edge cases**

| Document | Split | What is special | Expected |
|---|---|---|---|
| `harbourline-ii-2025q3-tvpi-misprint` | dev | printed TVPI is 0.12x too high: both reads see it, checks fail | review: "the report itself may be inconsistent" |
| `alpenrose-iv-2025q3-chart-nav` | dev | NAV exists only as a bar chart image (not in the text layer) | review: vision-only figure, reads not independent |
| `nordkap-iii-2025q3-restatement` | held-out | NAV footnoted as revised after the period; the multiples still use the old NAV | review; the correct NAV is the revised one |
| `harbourline-ii-2025q3-tvpi-misprint-scan` | dev | trap 1, scanned: no text layer, OCR noise on top of an inconsistent report | review |
| `nordkap-iii-2026q1-scan` | dev | clean report, scanned: European numbers under OCR | auto-post if OCR reads it right, otherwise review |
| `tessera-seed-i-2026q2` | held-out | GP not in the registry, unfamiliar layout | triage |

Traps sit in Q3 2025, a quarter no regular document covers, and scans are made only from dev documents, so no
held-out number ever appears in a dev document.

## Rules that keep the evaluation honest
- **Held-out is never used to tune prompts.** Prompts and code change only on dev; held-out is measured, and the
  result is reported as is (e.g. `docs/acceptance/2026-10-11-confidence.md`).
- **The pipeline never sees labels.** Seeding stores only descriptive metadata (`corpus_meta`), and the pipeline
  receives documents with even that removed (`forPipeline` in `core/documents.ts`).
- **Labels state the design, not the outcome.** Whether the two reads agree is decided at run time; the guaranteed proof
  of the "reads disagree" cases is the injected-misread safety test.

## Commands
| Command | What it does |
|---|---|
| `npm run corpus:generate` | regenerates every native document and every label (byte-deterministic) |
| `npm run corpus:scan` | remakes the two scans (needs poppler + ImageMagick; committed, not byte-checked) |
| `npm run corpus:verify` | labels valid, identities fail exactly as declared, files equal generator output; prints coverage |
| `npm run corpus:seed` | registers all documents on the site through the same step-1 path as uploads (idempotent) |
