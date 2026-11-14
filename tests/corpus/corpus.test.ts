import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateCorpus } from "../../corpus/generator/index.ts";
import { formatAmount, formatPercent, formatRatio } from "../../corpus/generator/format.ts";
import { profileByFundName } from "../../corpus/generator/profiles.ts";
import { verifyCorpus } from "../../corpus/verify-corpus.ts";
import { unzip } from "../support/unzip.ts";
import { CorpusLabel } from "../../core/schema.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const tempDirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "corpus-test-"));
  tempDirs.push(dir);
  return dir;
}
afterAll(async () => Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true }))));

async function hashTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const sub of ["corpus/docs", "corpus/labels"]) {
    for (const name of (await readdir(path.join(dir, sub))).sort()) {
      out[`${sub}/${name}`] = createHash("sha256").update(await readFile(path.join(dir, sub, name))).digest("hex");
    }
  }
  return out;
}

async function loadLabels(root: string): Promise<CorpusLabel[]> {
  const dir = path.join(root, "corpus/labels");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  return Promise.all(names.map(async (n) => CorpusLabel.parse(JSON.parse(await readFile(path.join(dir, n), "utf8")))));
}

describe("generateCorpus", () => {
  it("writes a PDF and a label for every manifest entry", async () => {
    const out = await tempDir();
    const written = await generateCorpus(out);

    expect(written).toEqual(expect.arrayContaining([
      "corpus/docs/alpenrose-iv-2025q4.pdf", "corpus/labels/alpenrose-iv-2025q4.json",
      "corpus/docs/alpenrose-iv-2026q1.pdf", "corpus/docs/alpenrose-iv-2026q2.pdf",
      "corpus/docs/harbourline-ii-2026q1.pdf", "corpus/labels/nordkap-iii-2026q2.json",
    ]));
  });

  it("writes Meridian as XLSX workbooks (two dev quarters, Q2 held out) whose labels keep the printed investment dates", async () => {
    const out = await tempDir();
    const written = await generateCorpus(out);
    const labels = (await loadLabels(out)).filter((l) => l.doc_id.startsWith("meridian-i-"));

    expect(written).toEqual(expect.arrayContaining(["corpus/docs/meridian-i-2025q4.xlsx", "corpus/docs/meridian-i-2026q2.xlsx"]));
    expect(labels.map((l) => [l.doc_id, l.split, l.format, l.expected_route])).toEqual([
      ["meridian-i-2025q4", "dev", "xlsx", "auto_post"],
      ["meridian-i-2026q1", "dev", "xlsx", "auto_post"],
      ["meridian-i-2026q2", "heldout", "xlsx", "auto_post"],
    ]);
    expect(labels[0]?.expected.portfolio_companies[0]?.investment_date).toMatch(/^\d{4}-\d{2}-15$/);
    expect((await readFile(path.join(out, "corpus/docs/meridian-i-2026q2.xlsx"))).subarray(0, 2).toString()).toBe("PK");
  });

  it("writes labels for the two scanned variants but leaves the scans themselves to corpus:scan", async () => {
    const out = await tempDir();
    const written = await generateCorpus(out);
    const labels = await loadLabels(out);
    const scans = labels.filter((l) => l.format === "scanned_pdf");
    const original = (docId: string) => labels.find((l) => l.doc_id === docId);

    expect(scans.map((l) => [l.doc_id, l.split, l.expected_route, l.trap ?? null])).toEqual([
      ["harbourline-ii-2025q3-tvpi-misprint-scan", "dev", "review", "tvpi_misprint"],
      ["nordkap-iii-2026q1-scan", "dev", "auto_post", null],
    ]);
    expect(scans[0]?.expected).toEqual(original("harbourline-ii-2025q3-tvpi-misprint")?.expected);
    expect(scans[1]?.expected).toEqual(original("nordkap-iii-2026q1")?.expected);
    expect(written).toContain("corpus/labels/nordkap-iii-2026q1-scan.json");
    expect(written).not.toContain("corpus/docs/nordkap-iii-2026q1-scan.pdf");
  });

  it("is byte-for-byte deterministic", async () => {
    const [a, b] = [await tempDir(), await tempDir()];
    await generateCorpus(a);
    await generateCorpus(b);

    expect(await hashTree(a)).toEqual(await hashTree(b));
  });
});

describe("verifyCorpus", () => {
  it("passes on the committed corpus: labels valid, identities as declared, files up to date", async () => {
    const { issues } = await verifyCorpus(ROOT);

    expect(issues).toEqual([]);
  });

  it("reports coverage: every confidence-matrix cell, triage and the correlated case are targeted, split 12 / 6", async () => {
    const { rows } = await verifyCorpus(ROOT);

    expect(rows).toHaveLength(18);
    expect(rows.filter((r) => r.split === "dev")).toHaveLength(12);
    expect(new Set(rows.map((r) => r.targets))).toEqual(new Set([
      "checks pass · reads agree", "checks fail · reads agree", "checks pass · reads may disagree (OCR)",
      "checks fail · reads may disagree (OCR)", "correlated reads (image only)", "triage",
    ]));
    expect(new Set(rows.map((r) => r.gp)).size).toBe(5);
    expect(new Set(rows.map((r) => r.format))).toEqual(new Set(["native_pdf", "scanned_pdf", "xlsx"]));
    expect(rows.find((r) => r.doc_id === "harbourline-ii-2025q3-tvpi-misprint-scan")).toMatchObject({
      scenario: "OCR + source inconsistency", targets: "checks fail · reads may disagree (OCR)", route: "review",
    });
  });

  it("reports a committed label that no longer matches the generator", async () => {
    const copy = await tempDir();
    await cp(path.join(ROOT, "corpus"), path.join(copy, "corpus"), { recursive: true });
    const labelPath = path.join(copy, "corpus/labels/alpenrose-iv-2026q1.json");
    const label = JSON.parse(await readFile(labelPath, "utf8"));
    label.expected.fund.nav.value += 1_000_000;
    await writeFile(labelPath, JSON.stringify(label, null, 2) + "\n");

    const { issues } = await verifyCorpus(copy);

    expect(issues.some((i) => i.includes("alpenrose-iv-2026q1.json") && i.includes("differs from generator"))).toBe(true);
  });
});

const hasPdftotext = (() => {
  try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); return true; } catch { return false; }
})();

describe.skipIf(!hasPdftotext)("rendered PDFs (needs poppler's pdftotext)", () => {
  const pageText = (file: string, page: number) =>
    execFileSync("pdftotext", ["-layout", "-f", String(page), "-l", String(page), path.join(ROOT, file), "-"], { encoding: "utf8" });

  const pdfLabels = async () => (await loadLabels(ROOT)).filter((l) => l.format === "native_pdf");

  it("print every fund figure and company total value on the page its label claims", async () => {
    for (const label of await pdfLabels()) {
      const style = profileByFundName(label.expected.classification.fund_name).style;
      const { fund, portfolio_companies } = label.expected;
      const expectations: [string, number][] = [
        // The chart trap's NAV exists only as pixels in an image: absent from the text layer by design.
        ...(["commitment", "paid_in", "unfunded", "distributions", ...(label.trap === "chart_nav" ? [] : ["nav"] as const)] as const)
          .map((k) => [formatAmount(fund[k]?.value ?? NaN, style), fund[k]?.source.page ?? 0] as [string, number]),
        ...(["tvpi", "dpi", "rvpi"] as const).map((k) => [formatRatio(fund[k]?.value ?? NaN, style.decimal), fund[k]?.source.page ?? 0] as [string, number]),
        [formatPercent(fund.net_irr?.value ?? NaN, 1, style.decimal), fund.net_irr?.source.page ?? 0],
        ...portfolio_companies.map((c) => [formatAmount(c.total_value?.value ?? NaN, style), c.total_value?.source.page ?? 0] as [string, number]),
      ];
      for (const [printed, page] of expectations) {
        expect(pageText(label.file, page), `${label.doc_id}: "${printed}" on page ${page}`).toContain(printed);
      }
    }
  }, 30_000); // runs pdftotext on every rendered PDF; 5 s is too tight under load

  it("carry the fictional-data footer on every page", async () => {
    for (const label of await pdfLabels()) {
      const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path.join(ROOT, label.file)], { encoding: "utf8" }))?.[1] ?? 0);
      expect(pages, label.doc_id).toBeGreaterThan(0);
      for (let page = 1; page <= pages; page++) {
        expect(pageText(label.file, page), `${label.doc_id} p${page}`).toMatch(/Fictional fund/);
      }
    }
  });
});

describe("rendered workbooks", () => {
  const sheets = async (file: string) => {
    const parts = unzip(await readFile(path.join(ROOT, file)));
    return (n: number) => parts.get(`xl/worksheets/sheet${n}.xml`)?.data.toString() ?? "";
  };
  const xlsxLabels = async () => (await loadLabels(ROOT)).filter((l) => l.format === "xlsx");

  it("hold every fund figure and company total value as a numeric cell on the sheet its label claims", async () => {
    for (const label of await xlsxLabels()) {
      const sheet = await sheets(label.file);
      const { fund, portfolio_companies } = label.expected;
      const values = [...Object.values(fund), ...portfolio_companies.map((c) => c.total_value)];
      for (const v of values) {
        expect(sheet(v?.source.page ?? 0), `${label.doc_id}: ${v?.value} on sheet ${v?.source.page}`).toContain(`<v>${v?.value}</v>`);
      }
    }
  });

  it("carry the fictional-data note on every sheet", async () => {
    for (const label of await xlsxLabels()) {
      const sheet = await sheets(label.file);
      for (const n of [1, 2, 3]) expect(sheet(n), `${label.doc_id} sheet ${n}`).toContain("Fictional fund");
    }
  });
});

describe.skipIf(!hasPdftotext)("scanned PDFs (needs poppler)", () => {
  const scanLabels = async () => (await loadLabels(ROOT)).filter((l) => l.format === "scanned_pdf");
  const pages = (file: string) => Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path.join(ROOT, file)], { encoding: "utf8" }))?.[1] ?? 0);

  it("have no text layer, one image per page, and as many pages as the original", async () => {
    for (const label of await scanLabels()) {
      const text = execFileSync("pdftotext", [path.join(ROOT, label.file), "-"], { encoding: "utf8" });
      const images = execFileSync("pdfimages", ["-list", path.join(ROOT, label.file)], { encoding: "utf8" }).trim().split("\n").slice(2);

      expect(text.replace(/\s/g, ""), label.doc_id).toBe("");
      expect(pages(label.file), label.doc_id).toBe(pages(label.file.replace("-scan.pdf", ".pdf")));
      expect(images.length, label.doc_id).toBe(pages(label.file));
    }
  });

  // Fund names are not asserted: OCR reads the roman numeral "II" as "||" (a realistic error that classify normalizes).
  it("stay legible: OCR at 150 dpi recovers the GP name, the printed TVPI and NAV", async () => {
    const { createOcr } = await import("../../netlify/lib/ocr.ts");
    const { renderPageToPng } = await import("../../netlify/lib/pdf.ts");
    const ocr = await createOcr();
    try {
      for (const label of await scanLabels()) {
        const style = profileByFundName(label.expected.classification.fund_name).style;
        const png = await renderPageToPng(new Uint8Array(await readFile(path.join(ROOT, label.file))), 1, 150);
        const { text, confidence } = await ocr.recognize(png);

        expect(text, label.doc_id).toContain(label.expected.classification.gp_name);
        expect(text, label.doc_id).toContain(formatRatio(label.expected.fund.tvpi?.value ?? NaN, style.decimal));
        expect(text, label.doc_id).toContain(formatAmount(label.expected.fund.nav?.value ?? NaN, style));
        expect(confidence, label.doc_id).toBeGreaterThan(80);
      }
    } finally {
      await ocr.close();
    }
  }, 60_000);
});
