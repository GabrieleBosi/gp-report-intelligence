import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { xlsxReadB } from "../../../core/confidence/xlsx-read-b.ts";
import type { ParsedPage } from "../../../core/pipeline/parse.ts";
import { parseStep } from "../../../core/pipeline/parse.ts";
import { SPREADSHEET_MIME } from "../../../core/documents.ts";
import { readSheets } from "../../../netlify/lib/xlsx.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
async function pagesOf(file: string): Promise<ParsedPage[]> {
  const bytes = new Uint8Array(await readFile(path.join(ROOT, file)));
  const { ctx } = await parseStep({ pdfTextPages: async () => [], sheets: readSheets }).run({ runId: "r", documentId: "d",
    loaded: { bytes, document: { id: "d", sha256: "", filename: "m.xlsx", mime: SPREADSHEET_MIME, size_bytes: 1, storage_path: "s", source: "corpus", corpus_meta: null, created_at: "" } } });
  return ctx.parsed?.pages ?? [];
}
const grid = (sheet: string, rows: string[]): ParsedPage => ({ page: 1, text: [`Sheet 1 "${sheet}"`, ...rows].join("\n"), source: "sheet", needsOcr: false });

describe("xlsxReadB: label-anchored cell lookup (no LLM)", () => {
  it("reads every key figure of the Meridian workbook from the cell next to its label, citing the sheet", async () => {
    const readB = xlsxReadB(await pagesOf("corpus/docs/meridian-i-2026q2.xlsx"));

    expect(readB.fund).toEqual({
      commitment: { raw: "300,000,000", page: 1 }, paid_in: { raw: "219,036,625", page: 1 },
      distributions: { raw: "49,471,491", page: 1 }, nav: { raw: "283,212,116", page: 1 },
      tvpi: { raw: "1.52x", page: 1 }, dpi: { raw: "0.23x", page: 1 },
    });
    expect(readB.companies.map((c) => c.name)).toEqual(["Brenvikkas Inc.", "Phakasro Ltd", "Veltovro Inc.", "Taphamor Inc.", "Salmor Ltd"]);
    expect(readB.companies[0]?.total_value).toEqual({ raw: "38,419,783", page: 2 });
  });

  it("matches whole labels only: 'Unfunded commitments' is not the commitment; the table ends at a blank row", () => {
    const readB = xlsxReadB([grid("Fund", [
      "A1: Unfunded commitments | B1: 80", "A2: Committed capital | B2: 300", "A3: Net asset value (NAV) | C3: 250",
      "A5: Holding | B5: Total value", "A6: Alpha AG | B6: 120", "A7: Beta SA | B7: 130", "A9: Fictional fund - note",
    ])]);

    expect(readB.fund.commitment).toEqual({ raw: "300", page: 1 });
    expect(readB.fund.nav).toEqual({ raw: "250", page: 1 });
    expect(readB.fund.tvpi).toEqual({ raw: null, page: null });
    expect(readB.companies).toEqual([{ name: "Alpha AG", total_value: { raw: "120", page: 1 } }, { name: "Beta SA", total_value: { raw: "130", page: 1 } }]);
  });
});
