import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RENDER_PIXELS, renderPageToPng } from "../../netlify/lib/pdf.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const alpenroseQ2 = () => readFile(path.join(ROOT, "corpus/docs/alpenrose-iv-2026q2.pdf"));

describe("renderPageToPng", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders a page as a PNG at the requested resolution", async () => {
    const png = await renderPageToPng(new Uint8Array(await alpenroseQ2()), 2, 150);
    const image = await loadImage(png);

    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(image.width).toBe(Math.floor((595.28 / 72) * 150));
  });

  it("clamps the canvas for a page with an absurd declared size (no out-of-memory)", async () => {
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ size: [14_400, 14_400] }); // 200 x 200 inches: 40,000 px a side at 200 dpi
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise((r) => doc.on("end", r));
    doc.text("huge page"); doc.end(); await done;

    const image = await loadImage(await renderPageToPng(new Uint8Array(Buffer.concat(chunks)), 1, 200));
    expect(image.width * image.height).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
    expect(image.width).toBe(image.height);
  });

  // Without its standard-font data pdf.js falls back to a substitute font with broken spacing ("Totalvalue",
  // "G ross M O IC"), which would mislead a vision read. It warns when that happens, so no warning = fonts resolved.
  it("loads the standard-font data instead of falling back to a substitute font", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await renderPageToPng(new Uint8Array(await alpenroseQ2()), 2, 150);

    const fontWarnings = warn.mock.calls.flat().filter((m) => String(m).includes("Unable to load font data"));
    expect(fontWarnings).toEqual([]);
  });

  it("rejects a page number outside the document", async () => {
    await expect(renderPageToPng(new Uint8Array(await alpenroseQ2()), 9, 150)).rejects.toThrow(/page 9/);
  });
});
