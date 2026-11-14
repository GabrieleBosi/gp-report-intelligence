# Spec: corpus

Module id: `corpus` · Depends on: — · Status: **approved** 2026-10-10

## Objective
A deterministic, synthetic set of private-equity GP quarterly reports with
golden labels. It feeds the demo (preloaded documents), the pipeline's
development and the eval gate. It must reproduce the variability named in the
case: PDFs, scans, spreadsheets, narrative sections and tables. It must also
contain deliberate traps that exercise every branch of the step-7 confidence
model. No real GP data is used anywhere.

It also defines the **canonical extraction schema v1** (`core/schema.ts`),
because labels and pipeline output must share one contract.

## Fictional universe
| GP | Fund | Format profile | Role |
|---|---|---|---|
| Alpenrose Capital | Alpenrose Buyout IV (EUR) | Clean native PDF, tables + narrative | Happy path |
| Harbourline Partners | Harbourline Growth II (USD) | Native PDF, figures in **USD m**, negatives in `(parentheses)` | Scale/sign normalization |
| Nordkap Equity | Nordkap Mid-Market III (EUR) | **European number format** `1.234,5`, landscape tables | Locale normalization |
| Meridian Growth | Meridian Tech Opportunities I (USD) | **XLSX** capital account statement; the cover letter is its third sheet | Spreadsheet path |
| Tessera Ventures | Tessera Seed Fund I (CHF) | Unseen layout | Unknown GP → triage |

Periods: Q4 2025, Q1 2026, Q2 2026 for the four known GPs, so quarter-on-quarter
plausibility checks have history. Tessera has Q2 2026 only.

## Schema v1 (what gets extracted)
- **Classification:** gp_name, fund_name, period_end (ISO date), report_type (`quarterly_report` | `capital_account_statement` | `other`), currency.
- **Fund key figures** (each a `Money` or ratio, with `source: { page, bbox? }`): commitment, paid_in, unfunded, distributions, nav, tvpi, dpi, rvpi, net_irr.
- **Portfolio companies[]:** name, sector, country, investment_date, invested, realized, unrealized, total_value, gross_moic, revenue_ltm, ebitda_ltm, net_debt (operating metrics nullable).
- **Qualitative:** key_updates[] (short strings), outlook (string, nullable).
- **Key figures** (the set that gets the dual read in step 7): commitment, paid_in, distributions, nav, tvpi, dpi, and each company's total_value.

## Documents (target: 18)
| # | Content | Count | Split |
|---|---|---|---|
| A | 4 GPs × 3 quarters, native PDF/XLSX | 12 | 9 dev / 3 held-out |
| B | Scanned version of a native report (rasterized, 2° skew, noise, **no text layer**). One of them scans trap 1, so OCR noise and a source inconsistency combine → *checks ❌ / agree ❌* | 2 | 1 / 1 |
| C | Tessera unknown-GP report | 1 | held-out |
| D | Trap documents (below), in Q3 2025 so no quarter is duplicated | 3 | 2 / 1 *(changed 2026-10-11: the critic and vision fallback are proven on traps by replay tests, which use dev only)* |

**Traps**, each mapped to the confidence branch it exercises:
1. **Source inconsistency:** the printed TVPI disagrees with (Dist + NAV)/Paid-in. Both reads should agree, the checks fail, and the label carries `expected_flags: ["tvpi_inconsistent"]`. → *checks ❌ / agree ✅*
2. **Chart-only figure:** NAV appears only in a bar chart rendered as an image, so the text read can't see it and the vision read can. → *checks ✅ / agree ❌* (or the vision fallback fills it)
3. **Restatement footnote:** the prior-quarter NAV is restated in a footnote. The label records the restated value. → tests the critic (step 6)

Scan noise is kept moderate, so a careful vision read *can* succeed.

## Label format
`corpus/labels/<doc-id>.json`, validated against the v1 zod schema:
```json
{
  "doc_id": "alpenrose-iv-2026q2",
  "file": "corpus/docs/alpenrose-iv-2026q2.pdf",
  "split": "dev",
  "format": "native_pdf",
  "expected": { "...schema v1 object, values as PRINTED, normalized to full units..." },
  "expected_flags": [],
  "expected_route": "auto_post"            // auto_post | review | triage
}
```
All JSON fields are snake_case (matching the DB columns); the schema lives in `core/schema.ts` (`CorpusLabel`, `Extraction`). Every figure is nullable, because "not stated" is a valid extraction.
The labels record **what is printed**, not what is "true". Catching
inconsistencies is the checks' job, not the extractor's.

## Generation
- Data first: a seeded generator builds each fund's portfolio and cash flows, then derives fund totals, so every non-trap doc is consistent by construction. Traps are injected only at render time and recorded in the label.
- Rendering: `pdfkit` (PDF), a small dependency-free XLSX writer (`corpus/generator/xlsx.ts`), with charts drawn as vector-then-rasterized images for trap 2. Scans: `pdftoppm` → ImageMagick (skew, noise, blur) → image-only PDF.
- Deterministic: fixed seed, fixed PDF creation dates and document IDs. Running it twice produces identical labels and identical native PDF/XLSX bytes (verified by test). Scans depend on the ImageMagick version, so they are generated once, committed and excluded from the byte check; their labels are still checked. Documents with rasterized content (the chart trap) differ in pixel bytes across machines, so they are compared by their text layer instead (found when CI failed on 2026-10-11).
- **Generated files are committed** (a few MB), so CI and Netlify never need poppler or ImageMagick.
- Fund names say "Fictional" in each PDF footer so no document can be mistaken for a real report.

## Commands
```
Generate:  npm run corpus:generate        # writes corpus/docs + corpus/labels
Verify:    npm run corpus:verify          # zod-validate labels, consistency checks, determinism
Seed DB:   npm run corpus:seed            # upload docs to Storage + insert `documents` (source='corpus')
```

## Project Structure
```
core/schema.ts            → canonical schema v1 (owned here, consumed by pipeline/evals)
corpus/generator/         → data model, renderers (pdf, xlsx, scan), traps
corpus/docs/              → generated documents (committed)
corpus/labels/            → golden labels (committed)
corpus/README.md          → the universe, the traps and the confidence branch each exercises
tests/corpus/             → determinism, label validity, consistency-by-construction
```

## Testing Strategy
- Every label parses with the v1 schema.
- For each non-trap label, the financial identities hold (see `core/checks/identities.ts`: TVPI/DPI/RVPI vs (distributions, NAV) / paid-in within ±0.01, paid_in ≤ commitment, unfunded = commitment − paid_in, Σ company **unrealized** within 10% of fund NAV, company total = realized + unrealized, gross MOIC, one currency, and quarter-on-quarter plausibility). *Corrected 2026-10-10:* the draft compared Σ company total_value to NAV within 1%, which is wrong. Total value includes realized proceeds that have already left the fund, and fund NAV is net of carry accrual and includes other net assets, so the bridge is legitimately a few percent.. The same identities are reused later by the `pipeline` checks.
- For each trap label, exactly the identity named in `expected_flags` fails.
- Determinism: generate twice into temp dirs and compare hashes.
- Native PDFs: `pdftotext` (local test only) finds the key figures. Scans: `pdftotext` returns roughly no text.

## Boundaries
- **Always:** keep labels and docs in sync through the generator (no hand-edited labels), and record every trap in `corpus/README.md`.
- **Ask first:** changing schema v1 after `pipeline` starts, growing the corpus past ~25 docs (eval cost), using any non-synthetic document.
- **Never:** use real GP reports, the case study's own materials, or real company names. Never evaluate on the held-out split while tuning prompts.

## Success Criteria
1. 18 documents across native PDF, scanned PDF and XLSX, from 5 GPs, with a 12 dev / 6 held-out split.
2. `npm run corpus:verify` passes: labels are valid, identities hold for non-trap docs and fail exactly as declared for trap docs, and generation is deterministic.
3. Each of the 4 confidence branches (pass/agree, pass/disagree, fail/agree, fail/disagree) is covered by at least 1 document's `expected_route` and flags.
4. `npm run corpus:seed` makes all 18 documents visible in Supabase (`documents.source = 'corpus'`).
5. A reviewer can open `corpus/README.md` and understand in 2 minutes why each document exists.

## Open Questions
> **Answered at approval (2026-10-10),** recorded in [CAPABILITY-MAP.md](CAPABILITY-MAP.md) › Decisions recorded at
> approval: (1) 18 documents; (2) a "Fictional" footer on each report.

1. Do 18 documents feel right for the demo? More documents make the eval metrics more convincing, but slow down each eval run and cost more in CI.
2. Should the fictional GPs carry a "Fictional" footer (proposed), or would you rather they look fully realistic?

## Changes during build
- **C6 (2026-10-11): no `exceljs`.** Measured: two exceljs workbooks built from identical input with fixed workbook
  dates differ in bytes (its zip stamps entries with the current time), and `npm audit` reports 2 moderate issues in its
  dependencies. The corpus must be byte-deterministic, so the generator writes the OOXML parts itself and zips them with
  `node:zlib` and a fixed timestamp (~150 lines, no dependency). Opens in LibreOffice with all values and formats intact.
- **C6: the cover letter is a sheet, not a separate PDF.** The pipeline handles one file per document and the
  18-document count has no slot for a companion file, so the letter (highlights, outlook) is the workbook's third
  sheet. For workbooks, a label's source `page` is the 1-based sheet number.
- **C8/C9 (2026-10-11): both scans in dev** (the table above says 1 / 1). With Meridian Q2 held out (latest quarter of
  every known GP), two dev scans give exactly 12 dev / 6 held-out, and scanning only dev documents keeps held-out numbers
  out of dev. Trade-off: the OCR path is measured on dev only.
- **C9: coverage is stated as design.** `corpus:verify` prints each document's scenario and the step-7 outcome it
  targets; "reads may disagree" for scans is a risk, not a guarantee (the safety test injects misreads to prove that cell).
