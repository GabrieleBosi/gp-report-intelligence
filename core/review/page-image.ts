// The source page beside the figures (SPEC-review flow 2), served through a function: the browser never talks to
// Supabase. Rendered once at the vision resolution and cached in the private page-images bucket; the cache path names
// the renderer version, so a pdf.js upgrade never serves an image made by the old renderer.
import { SPREADSHEET_MIME } from "../documents.ts";
import { sha256Hex } from "../hash.ts";
import { VISION_DPI, type PageRasterizer } from "../pipeline/extract.ts";

export const pageImagePath = (sha256: string, page: number, rasterizerVersion: string, dpi = VISION_DPI) =>
  `pages/${sha256}/p${page}@${dpi}-${rasterizerVersion}.png`;

// Shares every page the pipeline renders (vision fallback, read B: the same 130 dpi) with the review screen, so the
// analyst usually gets a cached image instead of a cold render. A cache failure never fails the render.
export function cachingRasterizer(inner: PageRasterizer, cache: { read(path: string): Promise<Buffer | null>; write(path: string, png: Buffer): Promise<void> }): PageRasterizer {
  return {
    version: inner.version,
    async renderPage(pdf, page, dpi) {
      const path = pageImagePath(await sha256Hex(pdf), page, inner.version, dpi);
      const cached = await cache.read(path).catch(() => null);
      if (cached) return cached;
      const png = await inner.renderPage(pdf, page, dpi);
      await cache.write(path, png).catch(() => {});
      return png;
    },
  };
}

export type PageImageDeps = {
  rasterizerVersion: string;
  documentOf(runId: string): Promise<{ sha256: string; mime: string; storage_path: string } | null>;
  readCache(path: string): Promise<Buffer | null>;
  writeCache(path: string, png: Buffer): Promise<void>;
  loadFile(storagePath: string): Promise<Uint8Array>;
  pageCount(pdf: Uint8Array): Promise<number>;
  render(pdf: Uint8Array, page: number, dpi: number): Promise<Buffer>;
};
export type PageImageResult = { status: 200; png: Buffer; cached: boolean } | { status: 404 | 415; error: string };

export async function pageImage(deps: PageImageDeps, runId: string, page: number): Promise<PageImageResult> {
  const doc = await deps.documentOf(runId);
  if (!doc) return { status: 404, error: "Run not found." };
  if (doc.mime === SPREADSHEET_MIME) return { status: 415, error: "This document is a workbook: its sheets are shown as text, not as images." };
  if (!Number.isInteger(page) || page < 1) return { status: 404, error: `There is no page ${page}.` };

  const path = pageImagePath(doc.sha256, page, deps.rasterizerVersion);
  const cached = await deps.readCache(path);
  if (cached) return { status: 200, png: cached, cached: true };

  const pdf = await deps.loadFile(doc.storage_path);
  const pages = await deps.pageCount(pdf);
  if (page > pages) return { status: 404, error: `There is no page ${page}: the document has ${pages}.` };
  const png = await deps.render(pdf, page, VISION_DPI);
  await deps.writeCache(path, png);
  return { status: 200, png, cached: false };
}
