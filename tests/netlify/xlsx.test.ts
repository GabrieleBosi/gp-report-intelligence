import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { zip } from "../../corpus/generator/xlsx.ts";
import { displayNumber, readSheets } from "../../netlify/lib/xlsx.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const part = (name: string, xml: string): [string, Buffer] => [name, Buffer.from(xml)];
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

// The way Excel itself writes: shared strings, built-in number formats, a sheet name only in workbook.xml.
function excelStyleWorkbook(extra: [string, Buffer][] = []): Buffer {
  return zip([
    part("xl/workbook.xml", `<workbook ${NS} xmlns:r="r"><sheets><sheet name="Fund &amp; LPs" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    part("xl/_rels/workbook.xml.rels", `<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    part("xl/sharedStrings.xml", `<sst ${NS}><si><t>NAV</t></si><si><r><t>Net </t></r><r><t>IRR</t></r></si></sst>`),
    part("xl/styles.xml", `<styleSheet ${NS}><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="3"/><xf numFmtId="10"/></cellXfs></styleSheet>`),
    part("xl/worksheets/sheet1.xml", `<worksheet ${NS}><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2" s="1"><v>1234567.4</v></c></row>` +
      `<row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3" s="2"><v>0.0712</v></c><c r="D3" t="str"><f>X</f><v>ok</v></c></row></sheetData></worksheet>`),
    ...extra,
  ], new Date("2026-01-01T00:00:00Z"));
}

describe("readSheets", () => {
  it("renders every sheet as rows of A1 refs with the values as displayed", async () => {
    const sheets = await readSheets(new Uint8Array(await readFile(path.join(ROOT, "corpus/docs/meridian-i-2026q2.xlsx"))));

    expect(sheets.map((s) => s.name)).toEqual(["Capital account", "Portfolio", "Letter to investors"]);
    expect(sheets[0]?.text).toContain("A6: Total commitments | B6: 300,000,000");
    expect(sheets[0]?.text).toMatch(/A13: TVPI \| B13: 1\.52x/);
    expect(sheets[0]?.text).toMatch(/Net IRR \| B\d+: 7\.9%/);
    expect(sheets[1]?.text).toContain("D6: 2022-12-15");
    expect(sheets[2]?.text).toContain("Dear Limited Partners,");
  });

  it("reads Excel-style workbooks: shared strings (incl. rich text), built-in formats, formula results", async () => {
    const [sheet] = await readSheets(new Uint8Array(excelStyleWorkbook()));

    expect(sheet).toEqual({ name: "Fund & LPs", text: "A2: NAV | C2: 1,234,567\nA3: Net IRR | C3: 7.12% | D3: ok" });
  });

  it("rejects what is not a workbook, and archives that would expand too far (zip bombs)", async () => {
    await expect(readSheets(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a valid XLSX/);
    // A part nothing references is never inflated; one a sheet points at is inflated against the budget.
    const unused = excelStyleWorkbook([["xl/media/big.bin", Buffer.alloc(60 * 1024 * 1024)]]);
    await expect(readSheets(new Uint8Array(unused))).resolves.toHaveLength(1);
    const bomb = zip([
      part("xl/workbook.xml", `<workbook ${NS} xmlns:r="r"><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      part("xl/_rels/workbook.xml.rels", `<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
      ["xl/worksheets/sheet1.xml", Buffer.alloc(60 * 1024 * 1024, 32)],
    ], new Date("2026-01-01T00:00:00Z"));
    await expect(readSheets(new Uint8Array(bomb))).rejects.toThrow(/too large/);
  });
});

const ACCOUNTING = '_(* #,##0_);_(* (#,##0);_(* "-"??_);_(@_)';

// What Excel displays (padding such as "_)" renders as blank space, trimmed here).
describe("displayNumber: real GP number formats", () => {
  it.each([
    [1000, "#,##0", "1,000"],
    [-1000, "#,##0", "-1,000"],
    [1234.5, "General", "1234.5"],
    [0.1 + 0.2, "General", "0.3"],
    [1000, "#,##0_);(#,##0)", "1,000"],
    [-1000, "#,##0_);(#,##0)", "(1,000)"],
    [0, "#,##0_);(#,##0)", "0"],
    [1000, ACCOUNTING, "1,000"],
    [-1000, ACCOUNTING, "(1,000)"],
    [0, ACCOUNTING, "-"],
    [1000, "#,##0;[Red]-#,##0", "1,000"],
    [-1000, "#,##0;[Red]-#,##0", "-1,000"],
    [-1000, "#,##0;[Red](#,##0)", "(1,000)"],
    [-12.34, "#,##0.0;(#,##0.0)", "(12.3)"],
    [0, '#,##0;-#,##0;"n/a"', "n/a"],
    [1234567, "#,##0,", "1,235"],
    [1234567, '#,##0,,"m"', "1m"],
    [1234567, '#,##0.0,,"m"', "1.2m"],
    [1000, "[$€-2] #,##0", "€ 1,000"],
    [1000, '"$"#,##0', "$1,000"],
    [1000, "\\$#,##0.00", "$1,000.00"],
    [0.0712, "0.00%", "7.12%"],
    [0.079, "0.0%", "7.9%"],
    [1.524, '0.00"x"', "1.52x"],
    [1.5, '0.00\\x', "1.50x"],
    [44635, "yyyy-mm-dd", "2022-03-15"],
    [44635, "dd/mm/yyyy", "15/03/2022"],
    [44635, "d-mmm-yy", "15-Mar-22"],
    [44635, "mmmm d, yyyy", "March 15, 2022"],
    [44635.5, "yyyy-mm-dd hh:mm", "2022-03-15 12:00"],
    [0.75, "h:mm", "18:00"],
  ])("%j as %j displays %j", (value, format, shown) => {
    expect(displayNumber(value, format)).toBe(shown);
  });

  it("never treats a colour or locale block as a date", () => {
    for (const format of ["[Red]#,##0", "[Blue]0.0%", "[$-409]#,##0", "[Color10]#,##0"]) {
      expect(displayNumber(1000, format), format).not.toMatch(/^\d{4}-/);
    }
  });
});

// Crafted workbooks from the security audit (2026-10-11). Each must be read or rejected quickly, never hang or blow up.
describe("readSheets on hostile workbooks", () => {
  const RELS = '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  const book = (sheets: string, sheet1: string, extra: [string, Buffer][] = []) => new Uint8Array(zip([
    part("xl/workbook.xml", `<workbook ${NS} xmlns:r="r"><sheets>${sheets}</sheets></workbook>`),
    part("xl/_rels/workbook.xml.rels", RELS), part("xl/worksheets/sheet1.xml", sheet1), ...extra,
  ], new Date("2026-01-01T00:00:00Z")));
  const oneSheet = '<sheet name="s" sheetId="1" r:id="rId1"/>';
  const timed = async (bytes: Uint8Array) => {
    const started = performance.now();
    const outcome = await readSheets(bytes).then(() => "read", (e: Error) => e.message);
    return { outcome, ms: performance.now() - started };
  };

  it("rejects unclosed cells in linear time (no regex backtracking)", async () => {
    const { outcome, ms } = await timed(book(oneSheet, `<worksheet><sheetData><row r="1">${'<c r="A1">'.repeat(200_000)}</row></sheetData></worksheet>`));

    expect(outcome).toMatch(/not a valid XLSX/);
    expect(ms).toBeLessThan(1_000);
  });

  it("caps the number of sheets (many sheets pointing at one large part)", async () => {
    const { outcome, ms } = await timed(book(oneSheet.repeat(2_000), "<worksheet><sheetData/></worksheet>"));

    expect(outcome).toMatch(/too many sheets/);
    expect(ms).toBeLessThan(1_000);
  });

  it("caps the text sent onwards (one huge shared string reused by many cells)", async () => {
    const shared = part("xl/sharedStrings.xml", `<sst ${NS}><si><t>${"A".repeat(20_000)}</t></si></sst>`);
    const cells = Array.from({ length: 1_000 }, (_, i) => `<c r="A${i + 1}" t="s"><v>0</v></c>`).join("");
    const { outcome, ms } = await timed(book(oneSheet, `<worksheet><sheetData><row r="1">${cells}</row></sheetData></worksheet>`, [shared]));

    expect(outcome).toMatch(/too large/);
    expect(ms).toBeLessThan(1_000);
  });

  it("caps the actually inflated bytes even when the zip directory understates them", async () => {
    const bytes = Buffer.from(book(oneSheet, `<worksheet><sheetData>${" ".repeat(60 * 1024 * 1024)}</sheetData></worksheet>`));
    // Rewrite every declared uncompressed size to 1 byte (central directory entries start with PK\x01\x02).
    for (let at = bytes.indexOf("PK\x01\x02"); at >= 0; at = bytes.indexOf("PK\x01\x02", at + 4)) bytes.writeUInt32LE(1, at + 24);

    const { outcome } = await timed(new Uint8Array(bytes));
    expect(outcome).toMatch(/too large/);
  });

  it("degrades hostile values instead of throwing (code points, huge dates, absurd decimals)", async () => {
    const styles = part("xl/styles.xml", `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="0.${"0".repeat(150)}"/></numFmts>` +
      `<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>`);
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x&#1114112;y&#xD800;</t></is></c>' +
      '<c r="B1" s="1"><v>1e300</v></c><c r="C1" s="2"><v>1.5</v></c></row></sheetData></worksheet>';

    const [result] = await readSheets(book(oneSheet, sheet, [styles]));
    expect(result?.text).toMatch(/^A1: x�y� \| B1: 1e\+300 \| C1: 1\.50{19}$/);
  });
});
