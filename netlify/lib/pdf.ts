// PDF page rendering for the vision steps (SPEC-pipeline, ADR-0004). pdf.js loads @napi-rs/canvas itself in Node,
// so both packages stay external to the function bundle (netlify.toml).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageRasterizer } from "../../core/pipeline/extract.ts";

// The corpus (and many GP reports) use the 14 standard fonts without embedding them; pdf.js needs its own font
// data to draw them, otherwise text renders as nothing and a vision read would see empty tables.
// Resolved from the module itself: the deployed bundle ships only traced files, so pdfjs-dist/package.json is absent.
const PDFJS_BUILD_DIR = path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs")));
const STANDARD_FONT_DATA_URL = `${path.resolve(PDFJS_BUILD_DIR, "../../standard_fonts")}/`;

// pdf.js may transfer (detach) the buffer it is given, so each call gets its own copy.
const open = (pdf: Uint8Array) => getDocument({ data: new Uint8Array(pdf), standardFontDataUrl: STANDARD_FONT_DATA_URL });

// Page count for the upload guardrail. Opens the document without rendering anything.
export async function countPages(pdf: Uint8Array): Promise<number> {
  const loading = open(pdf);
  try {
    return (await loading.promise).numPages;
  } finally {
    await loading.destroy();
  }
}

// A page may declare any size (PDF allows 200 x 200 inches, pdf.js does not clamp): the canvas would not fit in
// memory. Above ~16 megapixels the render resolution is lowered instead.
export const MAX_RENDER_PIXELS = 16_000_000;

export async function renderPageToPng(pdf: Uint8Array, pageNumber: number, dpi: number): Promise<Buffer> {
  const loading = open(pdf);
  try {
    const doc = await loading.promise;
    if (pageNumber < 1 || pageNumber > doc.numPages) {
      throw new Error(`page ${pageNumber} is outside this ${doc.numPages}-page document`);
    }
    const page = await doc.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(dpi / 72, Math.sqrt(MAX_RENDER_PIXELS / (natural.width * natural.height)));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    // White background: a transparent PNG can read as black-on-black to a vision model.
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement, // pdf.js types the DOM canvas; @napi-rs/canvas is its Node stand-in
      viewport, background: "#ffffff",
    }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await loading.destroy();
  }
}

type Fragment = { text: string; x: number; y: number; width: number };
const LINE_TOLERANCE = 2; // points: fragments this close vertically belong to one printed line
const COLUMN_GAP = 6; // points: a wider horizontal gap separates table columns, kept visible as 3 spaces

// Text per page in reading order. pdf.js returns positioned fragments, not lines; tables only stay readable for the
// LLM if each printed row comes out as one line, with its columns visibly separated.
export async function extractTextPages(pdf: Uint8Array): Promise<string[]> {
  const loading = open(pdf);
  try {
    const doc = await loading.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const fragments: Fragment[] = content.items.flatMap((item) =>
        "str" in item && item.str.trim() !== ""
          ? [{ text: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, width: item.width }]
          : []);
      pages.push(toLines(fragments));
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}

function toLines(fragments: Fragment[]): string {
  const lines: Fragment[][] = [];
  for (const fragment of [...fragments].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs((l[0]?.y ?? 0) - fragment.y) <= LINE_TOLERANCE);
    if (line) line.push(fragment);
    else lines.push([fragment]);
  }
  return lines.map((line) => {
    const sorted = line.sort((a, b) => a.x - b.x);
    return sorted.reduce((text, fragment, i) => {
      const previous = sorted[i - 1];
      if (!previous) return fragment.text;
      const gap = fragment.x - (previous.x + previous.width);
      return text + (gap > COLUMN_GAP ? "   " : gap > 0.5 ? " " : "") + fragment.text;
    }, "").trimEnd();
  }).join("\n");
}

// The vision fallback's renderer. Its version is part of every page image's cache identity.
export const pdfRasterizer: PageRasterizer = { version: `pdfjs@${pdfjsVersion}`, renderPage: renderPageToPng };
