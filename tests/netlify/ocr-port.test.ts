import { describe, expect, it } from "vitest";
import { createPdfPageOcr } from "../../netlify/lib/ocr.ts";

describe("createPdfPageOcr", () => {
  it("never throws on close, even when the OCR engine failed to start, and closes only once", async () => {
    let closes = 0;
    const broken = createPdfPageOcr(async () => Buffer.from("png"), async () => { throw new Error("wasm missing"); });
    await expect(broken.ocrPage(new Uint8Array([1]), 1)).rejects.toThrow(/wasm missing/);
    await expect(broken.close()).resolves.toBeUndefined();

    const working = createPdfPageOcr(async () => Buffer.from("png"),
      async () => ({ recognize: async () => ({ text: "ok", confidence: 90 }), close: async () => { closes++; throw new Error("already gone"); } }));
    await working.ocrPage(new Uint8Array([1]), 1);
    await expect(working.close()).resolves.toBeUndefined();
    await working.close();
    expect(closes).toBe(1);
  });
});
