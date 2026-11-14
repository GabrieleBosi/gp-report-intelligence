# ADR-0004: Render PDF pages (and OCR them) inside Netlify functions

Status: Accepted · rendering (P1) and OCR (P2), 2026-10-11

## Context
Two pipeline paths need page images: the vision fallback in step 4 and the independent vision read B in step 7.
Scans need OCR so that read A stays text-based (SPEC-pipeline decision 3). The open question was whether a Netlify
function can do this at all. The approved fallback was to render at ingest time (browser for uploads, `pdftoppm`
for the corpus).

## Decision: render server-side with pdf.js + @napi-rs/canvas (GO)
Measured on the deployed site (Alpenrose Q2 page 2 at 150 dpi, 1240×1754 px PNG, 110 KB):

| | cold start | warm |
|---|---|---|
| download from storage | 1,433 ms | 595 ms |
| render | 891 ms | 542 ms |
| upload PNG | 719 ms | 612 ms |
| total function duration | 3.9 s | 1.8 s |
| memory | 178 MB | 196 MB |

The production image is pixel-for-pixel the same layout as the local render, with real fonts.

## What it took (three deploy-only failures, each now guarded)
1. **Standard fonts.** The corpus (like many GP reports) uses non-embedded standard fonts. Without pdf.js's
   `standard_fonts` data, text renders in a substitute font with broken spacing ("G ross M O IC"), which a vision
   model would misread. Guard: a unit test fails on pdf.js's "Unable to load font data" warning.
2. **Untraced files.** The bundler ships only traced files: `pdfjs-dist/package.json` (used to locate the fonts)
   was missing, so the module crashed at load and logged nothing. The fonts are now resolved via
   `import.meta.resolve` of the module itself.
3. **Dynamic worker import.** `legacy/build/pdf.worker.mjs` is loaded dynamically and was also missing.

All three are invisible to unit tests. `scripts/check-function-bundles.sh` builds exactly like a deploy, imports
every bundled function with Node 22, and renders a real page from each pdf.js bundle using only its own files.
It reported failure 3 before the fix.

## Decision: OCR server-side with tesseract.js (GO)
Measured on the deployed site (same page rendered at 200 dpi, then OCR):

| | value |
|---|---|
| OCR time (includes worker start and model load) | 5.8 s |
| mean word confidence | 94 |
| text | all company rows and the "Total portfolio" row read correctly |
| function memory | 339 MB (limit 1,024 MB) |
| bundle (rendering + OCR) | 26 MB zipped (limit 50 MB) |

OCR only runs for pages without a usable text layer (scans), so ~6 s per scanned page fits comfortably inside a
15-minute background function. Rendering at 200 dpi (not 150) for OCR: smaller digits otherwise blur together.

Details that matter:
- **No runtime download.** The LSTM-only English model (`@tesseract.js-data/eng`, `4.0.0_best_int`, 2.9 MB) ships
  in the bundle and `langPath` points at it. Without that, tesseract.js fetches from a CDN on every cold start:
  slower, and an external dependency a bank would not accept on the extraction path.
- **Upstream bug, worked around.** tesseract.js 7 passes the boolean `lstmOnly` into `getCore(oem, ...)`, which
  compares it with numeric OEM constants, so it always loads the full (legacy + LSTM) wasm core. OCR is still
  correct, since the model data is LSTM-only; it only costs bundle size. We ship exactly the core Node 22 selects
  (`relaxedsimd`), and the bundle check (Node 22, same as production) fails if that ever changes.
- tesseract.js's `opencollective-postinstall` banner script is denied in npm's install-script allowlist.
- The Netlify log stream dropped some background-function lines; storage timestamps confirmed every run executed.

## Consequences
- The pdf.js externals/includes are scoped per function in `netlify.toml` (other bundles stay small: health 660 KB).
  Every new rendering function must be added there; the bundle check fails if one is forgotten.
- The rendering + OCR bundle is 26 MB zipped, leaving ~24 MB headroom under the 50 MB limit.
- Page images go to the private `page-images` bucket at `<sha256>/p<page>@<dpi>.png` (content-addressed, so cacheable).
- The render-at-ingest fallback is not needed.
