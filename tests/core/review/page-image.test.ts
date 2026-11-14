import { describe, expect, it } from "vitest";
import { cachingRasterizer, pageImage, pageImagePath, type PageImageDeps } from "../../../core/review/page-image.ts";
import { sha256Hex } from "../../../core/hash.ts";
import { SPREADSHEET_MIME } from "../../../core/documents.ts";

const doc = { sha256: "a".repeat(64), mime: "application/pdf", storage_path: "corpus/a.pdf" };

function deps(over: Partial<PageImageDeps> = {}) {
  const calls = { renders: 0, writes: [] as string[] };
  const d: PageImageDeps = {
    rasterizerVersion: "pdfjs@6.4.299",
    async documentOf() { return doc; },
    async readCache() { return null; },
    async writeCache(path) { calls.writes.push(path); },
    async loadFile() { return new Uint8Array([1]); },
    async pageCount() { return 3; },
    async render(_pdf, page, dpi) { calls.renders++; return Buffer.from(`png-${page}@${dpi}`); },
    ...over,
  };
  return { d, calls };
}

describe("pageImage (GET /api/runs/:id/pages/:n)", () => {
  it("renders the page at 130 dpi and caches it under a path that names the renderer version", async () => {
    const { d, calls } = deps();

    const result = await pageImage(d, "run-1", 2);

    expect(result).toEqual({ status: 200, png: Buffer.from("png-2@130"), cached: false });
    expect(calls.writes).toEqual([`pages/${"a".repeat(64)}/p2@130-pdfjs@6.4.299.png`]);
  });

  it("serves a cached page without rendering", async () => {
    const { d, calls } = deps({ readCache: async () => Buffer.from("cached") });

    expect(await pageImage(d, "run-1", 1)).toEqual({ status: 200, png: Buffer.from("cached"), cached: true });
    expect(calls.renders).toBe(0);
  });

  it.each([[0], [4], [1.5]])("answers 404 for page %j of a 3-page document", async (page) => {
    expect(await pageImage(deps().d, "run-1", page)).toMatchObject({ status: 404 });
  });

  it("answers 404 for an unknown run and 415 for a workbook (its sheets are shown as text)", async () => {
    expect(await pageImage(deps({ documentOf: async () => null }).d, "run-x", 1)).toMatchObject({ status: 404 });
    expect(await pageImage(deps({ documentOf: async () => ({ ...doc, mime: SPREADSHEET_MIME }) }).d, "run-1", 1))
      .toMatchObject({ status: 415, error: expect.stringMatching(/workbook/) });
  });
});

describe("cachingRasterizer", () => {
  it("stores every page the pipeline renders under the path the review screen reads, and reuses it", async () => {
    const store = new Map<string, Buffer>();
    let renders = 0;
    const inner = { version: "pdfjs@6.4.299", async renderPage(_pdf: Uint8Array, page: number, dpi: number) { renders++; return Buffer.from(`png-${page}@${dpi}`); } };
    const rasterizer = cachingRasterizer(inner, { read: async (p) => store.get(p) ?? null, write: async (p, png) => { store.set(p, png); } });
    const pdf = new TextEncoder().encode("%PDF-1.7 test");

    await rasterizer.renderPage(pdf, 2, 130);
    const again = await rasterizer.renderPage(pdf, 2, 130);

    expect(renders).toBe(1);
    expect(again).toEqual(Buffer.from("png-2@130"));
    expect([...store.keys()]).toEqual([pageImagePath(await sha256Hex(pdf), 2, "pdfjs@6.4.299")]);
    expect(rasterizer.version).toBe("pdfjs@6.4.299");
  });

  it("never fails a render because the cache is unavailable", async () => {
    const inner = { version: "v", async renderPage() { return Buffer.from("png"); } };
    const rasterizer = cachingRasterizer(inner, { read: async () => { throw new Error("storage down"); }, write: async () => { throw new Error("storage down"); } });

    await expect(rasterizer.renderPage(new Uint8Array([1]), 1, 130)).resolves.toEqual(Buffer.from("png"));
  });
});
