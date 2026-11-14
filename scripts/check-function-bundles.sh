#!/usr/bin/env bash
# Builds the functions exactly as a Netlify deploy does and imports each bundled module with Node 22.
# Catches what unit tests cannot: files missing from the zip, bad externals, module-load errors (P1 lesson).
set -euo pipefail
cd "$(dirname "$0")/.."
# Start clean: netlify build leaves zips of deleted functions behind, which would be checked as if they still existed.
rm -rf .netlify/functions
mise exec node@22 -- netlify build --offline > /tmp/netlify-build.log 2>&1 || { tail -20 /tmp/netlify-build.log; exit 1; }
fail=0
for zip in .netlify/functions/*.zip; do
  dir="$(mktemp -d)"; unzip -q "$zip" -d "$dir"
  name="$(basename "$zip" .zip)"
  if out="$(cd "$dir" && mise exec node@22 -- node -e "import('./netlify/functions/$name.mjs').then(() => {}, e => { console.error(String(e.message).split('\n')[0]); process.exit(1); })" 2>&1)"; then
    echo "PASS  $name loads ($(du -h "$zip" | cut -f1))"
  else
    echo "FAIL  $name: $out"; fail=1
  fi
  # Bundles that ship pdf.js must render a real page with only their own files (worker and fonts load lazily).
  if [[ -d "$dir/node_modules/pdfjs-dist" ]]; then
    cp corpus/docs/alpenrose-iv-2026q2.pdf "$dir/sample.pdf"
    cat > "$dir/render-check.mjs" <<'JS'
import { readFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const fonts = new URL("./node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;
const warnings = []; console.warn = (...a) => warnings.push(a.join(" "));
const task = getDocument({ data: new Uint8Array(readFileSync("sample.pdf")), standardFontDataUrl: fonts });
const page = await (await task.promise).getPage(2);
const viewport = page.getViewport({ scale: 1 });
await page.render({ canvas: createCanvas(Math.floor(viewport.width), Math.floor(viewport.height)), viewport }).promise;
await task.destroy();
if (warnings.some((w) => w.includes("Unable to load font data"))) { console.error("fonts missing"); process.exit(1); }
JS
    if out="$(cd "$dir" && mise exec node@22 -- node render-check.mjs 2>&1)"; then echo "PASS  $name renders a page"
    else echo "FAIL  $name render: $(tail -1 <<<"$out" | cut -c1-200)"; fail=1; fi
  fi
  # Bundles that ship tesseract.js must OCR a rendered page with only their own files (worker, wasm core, language data).
  if [[ -d "$dir/node_modules/tesseract.js" ]]; then
    node -e "import('./netlify/lib/pdf.ts').then(async m => require('fs').writeFileSync('$dir/page.png', await m.renderPageToPng(new Uint8Array(require('fs').readFileSync('corpus/docs/alpenrose-iv-2026q2.pdf')), 2, 200)))"
    cat > "$dir/ocr-check.mjs" <<'JS'
import { readFileSync } from "node:fs";
const fn = await import("./netlify/functions/__FN__.mjs");
if (typeof fn.ocrSelfCheck !== "function") { console.error("function does not export ocrSelfCheck"); process.exit(1); }
const { text, confidence } = await fn.ocrSelfCheck(readFileSync("page.png"));
if (!text.includes("506.9") || confidence < 80) { console.error(`bad OCR: confidence ${confidence}`); process.exit(1); }
console.log(`confidence ${Math.round(confidence)}`);
JS
    sed -i "s/__FN__/$name/" "$dir/ocr-check.mjs"
    if out="$(cd "$dir" && mise exec node@22 -- node ocr-check.mjs 2>&1)"; then echo "PASS  $name runs OCR ($(tail -1 <<<"$out"))"
    else echo "FAIL  $name OCR: $(grep -vE '^\s+at ' <<<"$out" | tail -2 | tr '\n' ' ' | cut -c1-250)"; fail=1; fi
  fi
  rm -rf "$dir"
done
exit $fail
