// Recorded on every run (SPEC-pipeline "Versioning"). Bump it whenever a step, prompt, model or policy changes: evals,
// the audit trail and the Run page compare runs by this string.
// 0.1.0 load · 0.2.0 + parse · 0.3.0 + classify@1 · 0.4.0 + extract-{fund,portfolio,operating,qualitative}@1, normalize
// · 0.5.0 + critic-fields@1, critic-portfolio@1 · 0.6.0 + vision fallback extract-{fund,portfolio}-vision@1 at 130 dpi
// · 0.7.0 + confidence: read-b@1, policy@1 (all LLM steps on claude-opus-5-5)
// · 0.8.0 parse: OCR for pages without a text layer (tesseract.js, 200 dpi), XLSX sheets as cell grids
// · 0.8.1 normalize drops blank placeholder rows; an empty portfolio with a NAV fails the bridge (critic re-reads it)
// · 0.9.0 + classify-scan@1: scans are classified from the page-1 image as well as the OCR text
// · 0.9.1 + company_ebitda_exceeds_revenue plausibility check; the critic can re-read operating metrics
// · 0.9.2 XLSX number formats displayed as Excel shows them (sections by sign, padding, colour/locale blocks, scaling)
// · 0.9.3 XLSX reader: linear scanner, one inflate budget, caps on sheets / cells / text (security audit)
// · 0.9.4 one filtered raw handed on by step 5 and the critic; shared operating join, duplicate rows are an issue
// · 0.9.5 20-page cap, OCR worker released after parse, render clamped to 16 MP, page/document tags neutralised in page text
// · 0.10.0 + read B for workbooks: label-anchored cell lookup (no LLM)
// · 0.10.1 parse rejects more than 300k characters of text; LLM calls refused when their estimated cost crosses the budget
// · 0.11.0 policy@2: uploaded documents always go to review
// · 0.11.1 triage runs render their first 3 pages for the review screen (no LLM call)
// · 0.12.0 classify, extract and read B on claude-sonnet-5-5; critic stays on claude-opus-5-5 (shadow evals 2026-10-11)
// · 0.12.1 rollback: every step back on claude-opus-5-5 (held-out: the Sonnet switch auto-posted the restatement trap)
// · 0.13.0 policy@3: a footnote marker in either read keeps a key figure from auto-posting
export const PIPELINE_VERSION = "pipeline@0.13.0";
