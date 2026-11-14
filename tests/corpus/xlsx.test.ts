import { describe, expect, it } from "vitest";
import { writeWorkbook } from "../../corpus/generator/xlsx.ts";
import { renderCapitalAccountWorkbook } from "../../corpus/generator/render-xlsx.ts";
import { generateFund } from "../../corpus/generator/model.ts";
import { profileById } from "../../corpus/generator/profiles.ts";
import { unzip } from "../support/unzip.ts";

const created = new Date("2026-08-14T00:00:00Z");
const workbook = () => writeWorkbook({
  title: "T", author: "A", created,
  sheets: [
    { name: "Numbers", rows: [["Label", 1234.5, { value: 0.106, format: "0.0%" }], [], ["Date", { date: "2022-03-15" }]] },
    { name: "Text & <escapes>", rows: [["a < b & \"c\""]] },
  ],
});

describe("writeWorkbook (dependency-free, deterministic XLSX)", () => {
  it("writes a valid zip with every OOXML part and correct checksums", async () => {
    const parts = unzip(await workbook());

    expect([...parts.keys()]).toEqual(expect.arrayContaining([
      "[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
      "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
    ]));
    expect([...parts.values()].every((p) => p.crcOk)).toBe(true);
  });

  it("is byte-identical across runs (fixed zip timestamps and document dates)", async () => {
    const first = await workbook();
    await new Promise((r) => setTimeout(r, 1100));

    expect((await workbook()).equals(first)).toBe(true);
    expect(unzip(first).get("docProps/core.xml")?.data.toString()).toContain("2026-08-14T00:00:00Z");
  });

  it("stores numbers as numeric cells, dates as Excel serials, and escapes text", async () => {
    const parts = unzip(await workbook());
    const sheet1 = parts.get("xl/worksheets/sheet1.xml")?.data.toString() ?? "";
    const sheet2 = parts.get("xl/worksheets/sheet2.xml")?.data.toString() ?? "";

    expect(sheet1).toMatch(/<c r="B1"[^>]*><v>1234.5<\/v><\/c>/);
    expect(sheet1).toMatch(/<c r="C1" s="\d+"><v>0.106<\/v><\/c>/);
    expect(sheet1).toMatch(/<c r="B3" s="\d+"><v>44635<\/v><\/c>/); // 2022-03-15
    expect(sheet2).toContain("a &lt; b &amp; &quot;c&quot;");
    expect(parts.get("xl/workbook.xml")?.data.toString()).toContain('name="Text &amp; &lt;escapes&gt;"');
  });
});

describe("renderCapitalAccountWorkbook (Meridian)", () => {
  const profile = profileById("meridian-i");
  const report = generateFund(profile, 4401)[2];
  if (!report) throw new Error("no Q2");

  it("prints the fund figures on sheet 1, the portfolio on sheet 2 and the letter on sheet 3", async () => {
    const parts = unzip(await renderCapitalAccountWorkbook(report));
    const sheet = (n: number) => parts.get(`xl/worksheets/sheet${n}.xml`)?.data.toString() ?? "";

    expect(parts.get("xl/workbook.xml")?.data.toString()).toMatch(/Capital account.*Portfolio.*Letter to investors/s);
    expect(sheet(1)).toContain(`<v>${report.fund.nav?.value}</v>`);
    expect(sheet(1)).toContain(`<v>${report.fund.tvpi?.value}</v>`);
    expect(sheet(1)).toContain("Meridian Tech Opportunities I");
    for (const company of report.portfolio_companies) {
      expect(sheet(2)).toContain(company.name);
      expect(sheet(2)).toContain(`<v>${company.total_value?.value}</v>`);
    }
    expect(sheet(3)).toContain(report.qualitative.key_updates[0] ?? "missing update");
    expect(sheet(3)).toContain("Fictional fund");
  });

  it("cites sheets as source pages: fund figures on 1, companies and operating metrics on 2", () => {
    expect(report.fund.nav?.source.page).toBe(1);
    expect(report.portfolio_companies[0]?.total_value?.source.page).toBe(2);
    expect(report.portfolio_companies[0]?.revenue_ltm?.source.page).toBe(2);
  });
});
