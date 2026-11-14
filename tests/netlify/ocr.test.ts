import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CorpusLabel } from "../../core/schema.ts";
import { formatAmount } from "../../corpus/generator/format.ts";
import { profileById } from "../../corpus/generator/profiles.ts";
import { createOcr, type Ocr } from "../../netlify/lib/ocr.ts";
import { renderPageToPng } from "../../netlify/lib/pdf.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
let ocr: Ocr | undefined;
afterAll(async () => ocr?.close());

describe("ocr", () => {
  it("reads every company total value from a rendered portfolio page, with a confidence score", async () => {
    const label = CorpusLabel.parse(JSON.parse(await readFile(path.join(ROOT, "corpus/labels/alpenrose-iv-2026q2.json"), "utf8")));
    const png = await renderPageToPng(new Uint8Array(await readFile(path.join(ROOT, label.file))), 2, 200);
    ocr = await createOcr();

    const { text, confidence } = await ocr.recognize(png);

    const style = profileById("alpenrose-iv").style;
    for (const company of label.expected.portfolio_companies) {
      expect(text, company.name).toContain(formatAmount(company.total_value?.value ?? NaN, style));
    }
    expect(confidence).toBeGreaterThan(80);
  }, 60_000);
});
