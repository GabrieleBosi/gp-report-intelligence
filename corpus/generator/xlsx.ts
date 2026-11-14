// A minimal, dependency-free XLSX writer (OOXML parts + a stored-timestamp zip). exceljs was the plan, but its zip
// stamps entries with the current time, so two identical workbooks differ in bytes, and the corpus must be byte-
// deterministic (SPEC-corpus). Supports what the corpus needs: text, numbers with a number format, dates, bold.
import { crc32, deflateRawSync } from "node:zlib";

export type Cell = string | number | null
  | { value: number; format?: string; bold?: boolean }
  | { text: string; bold?: boolean }
  | { date: string; format?: string }; // ISO date, stored as an Excel serial number
export type Sheet = { name: string; rows: Cell[][]; widths?: number[] };
export type Workbook = { title: string; author: string; created: Date; sheets: Sheet[] };

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const column = (i: number): string => (i >= 26 ? column(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
const excelSerial = (iso: string) => (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;

export async function writeWorkbook(wb: Workbook): Promise<Buffer> {
  // Styles: index 0 is the default; every distinct (format, bold) pair used gets its own cellXfs entry.
  const formats: string[] = [];
  const styles: { format: string | null; bold: boolean }[] = [{ format: null, bold: false }];
  const styleOf = (format: string | null, bold: boolean) => {
    if (format && !formats.includes(format)) formats.push(format);
    let index = styles.findIndex((s) => s.format === format && s.bold === bold);
    if (index < 0) index = styles.push({ format, bold }) - 1;
    return index;
  };

  const sheetXml = (sheet: Sheet) => {
    const rows = sheet.rows.map((cells, r) => {
      const xml = cells.map((cell, c) => {
        if (cell === null || cell === "") return "";
        const ref = `${column(c)}${r + 1}`;
        if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
        if (typeof cell === "string") return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(cell)}</t></is></c>`;
        if ("date" in cell) return `<c r="${ref}" s="${styleOf(cell.format ?? "yyyy-mm-dd", false)}"><v>${excelSerial(cell.date)}</v></c>`;
        if ("text" in cell) {
          const s = styleOf(null, cell.bold ?? false);
          return `<c r="${ref}"${s ? ` s="${s}"` : ""} t="inlineStr"><is><t xml:space="preserve">${escape(cell.text)}</t></is></c>`;
        }
        const s = styleOf(cell.format ?? null, cell.bold ?? false);
        return `<c r="${ref}"${s ? ` s="${s}"` : ""}><v>${cell.value}</v></c>`;
      }).join("");
      return xml ? `<row r="${r + 1}">${xml}</row>` : "";
    }).join("");
    const cols = sheet.widths
      ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS}">${cols}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const sheets = wb.sheets.map(sheetXml); // before styles.xml: rendering the cells registers the styles

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${NS}">` +
    (formats.length ? `<numFmts count="${formats.length}">${formats.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${escape(f)}"/>`).join("")}</numFmts>` : "") +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${styles.length}">${styles.map((s) => {
      const numFmtId = s.format ? 164 + formats.indexOf(s.format) : 0;
      return `<xf numFmtId="${numFmtId}" fontId="${s.bold ? 1 : 0}" fillId="0" borderId="0" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ""}${s.bold ? ' applyFont="1"' : ""}/>`;
    }).join("")}</cellXfs></styleSheet>`;

  const iso = wb.created.toISOString().replace(/\.\d{3}Z$/, "Z");
  const parts: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      wb.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${escape(wb.title)}</dc:title><dc:creator>${escape(wb.author)}</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>` +
      wb.sheets.map((s, i) => `<sheet name="${escape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + `</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      wb.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${wb.sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", stylesXml],
    ...sheets.map((xml, i) => [`xl/worksheets/sheet${i + 1}.xml`, xml] as [string, string]),
  ];
  return zip(parts.map(([name, text]) => [name, Buffer.from(text, "utf8")]), wb.created);
}

// Zip with deflate and a fixed timestamp (the workbook's own date), so the bytes depend only on the content.
export function zip(entries: [string, Buffer][], date: Date): Buffer {
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const dosDate = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(dosTime, 10); header.writeUInt16LE(dosDate, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(header, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += header.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
