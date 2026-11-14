import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CorpusLabel } from "../../core/schema.ts";
import { formatAmount, formatPercent, formatRatio } from "../../corpus/generator/format.ts";
import { profileByFundName } from "../../corpus/generator/profiles.ts";
import { extractTextPages } from "../../netlify/lib/pdf.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");

async function pdfLabels(): Promise<CorpusLabel[]> {
  const dir = path.join(ROOT, "corpus/labels");
  const labels = await Promise.all((await readdir(dir)).map(async (n) => CorpusLabel.parse(JSON.parse(await readFile(path.join(dir, n), "utf8")))));
  return labels.filter((l) => l.format === "native_pdf");
}

describe("extractTextPages", () => {
  it("returns one text per page", async () => {
    const pages = await extractTextPages(new Uint8Array(await readFile(path.join(ROOT, "corpus/docs/alpenrose-iv-2026q2.pdf"))));
    const tessera = await extractTextPages(new Uint8Array(await readFile(path.join(ROOT, "corpus/docs/tessera-seed-i-2026q2.pdf"))));

    expect(pages).toHaveLength(3);
    expect(tessera).toHaveLength(2);
  });

  it("puts every labeled fund figure and company total on the page its label cites", async () => {
    for (const label of await pdfLabels()) {
      const pages = await extractTextPages(new Uint8Array(await readFile(path.join(ROOT, label.file))));
      const style = profileByFundName(label.expected.classification.fund_name).style;
      const { fund } = label.expected;
      const expected: [string, number | undefined][] = [
        // The chart trap's NAV exists only as pixels in an image: absent from the text layer by design.
        ...(["commitment", "paid_in", "unfunded", "distributions", ...(label.trap === "chart_nav" ? [] : ["nav"] as const)] as const).map((k) =>
          [formatAmount(fund[k]?.value ?? NaN, style), fund[k]?.source.page] as [string, number | undefined]),
        ...(["tvpi", "dpi", "rvpi"] as const).map((k) => [formatRatio(fund[k]?.value ?? NaN, style.decimal), fund[k]?.source.page] as [string, number | undefined]),
        [formatPercent(fund.net_irr?.value ?? NaN, 1, style.decimal), fund.net_irr?.source.page],
      ];
      for (const [printed, page] of expected) {
        expect(pages[(page ?? 0) - 1], `${label.doc_id}: "${printed}" on page ${page}`).toContain(printed);
      }
    }
  });

  it("keeps each portfolio row on one line, so a company's numbers stay with its name", async () => {
    for (const label of await pdfLabels()) {
      const pages = await extractTextPages(new Uint8Array(await readFile(path.join(ROOT, label.file))));
      const style = profileByFundName(label.expected.classification.fund_name).style;
      for (const company of label.expected.portfolio_companies) {
        const page = pages[(company.total_value?.source.page ?? 0) - 1] ?? "";
        // The table row, not a narrative bullet that mentions the company: the name followed by a column gap.
        const line = page.split("\n").find((l) => l.startsWith(`${company.name}   `)) ?? "";
        expect(line, `${label.doc_id} ${company.name}`).toContain(formatAmount(company.total_value?.value ?? NaN, style));
        expect(line, `${label.doc_id} ${company.name}`).toContain(formatRatio(company.gross_moic?.value ?? NaN, style.decimal));
      }
    }
  });
});
