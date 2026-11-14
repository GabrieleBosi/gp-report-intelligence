// Reads an XLSX workbook into one text grid per sheet ("A6: Total commitments | B6: 300,000,000"), values as the
// spreadsheet displays them, so read A transcribes a workbook exactly as it transcribes a printed page.
// No dependency and no XML parser (so no entity expansion / XXE). Uploads are untrusted (security audit 2026-10-11):
// elements are found with a linear indexOf scanner (no regex backtracking), each part is inflated once against one
// budget of bytes actually produced, and sheets, cells and output text are capped.
import { inflateRawSync } from "node:zlib";

const MAX_INFLATED_BYTES = 50 * 1024 * 1024; // all parts together, as actually inflated
const MAX_ENTRIES = 2_000;
const MAX_SHEETS = 50;
const MAX_CELLS = 100_000;
const MAX_OUTPUT_CHARS = 300_000; // the text read A receives; a real GP workbook is a few thousand characters
const MAX_STRING_CHARS = 32_767; // Excel's own limit for one cell

const tooLarge = (what: string) => new Error(`workbook too large (${what})`);
const invalid = (what: string) => new Error(`not a valid XLSX file (${what})`);

type Entry = { method: number; offset: number; compressedSize: number };

function centralDirectory(buf: Buffer): Map<string, Entry> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > buf.length) throw invalid("no zip directory");
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw tooLarge("too many parts");
  const entries = new Map<string, Entry>();
  let at = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw invalid("corrupt zip directory");
    const nameLength = buf.readUInt16LE(at + 28);
    entries.set(buf.subarray(at + 46, at + 46 + nameLength).toString("utf8"),
      { method: buf.readUInt16LE(at + 10), compressedSize: buf.readUInt32LE(at + 20), offset: buf.readUInt32LE(at + 42) });
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return entries;
}

// Inflates each part at most once; every part draws on one budget of real output bytes (declared sizes can lie).
function partReader(buf: Buffer, entries: Map<string, Entry>) {
  const cache = new Map<string, string>();
  let used = 0;
  return (name: string): string | null => {
    const cached = cache.get(name);
    if (cached !== undefined) return cached;
    const e = entries.get(name);
    if (!e) return null;
    if (e.offset + 30 > buf.length) throw invalid("part outside the file");
    const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
    const raw = buf.subarray(start, start + e.compressedSize);
    let data: Buffer;
    try {
      data = e.method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.max(MAX_INFLATED_BYTES - used, 1) }) : raw;
    } catch (error) {
      if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw tooLarge("uncompressed size");
      throw invalid(`cannot inflate ${name}`);
    }
    used += data.length;
    if (used > MAX_INFLATED_BYTES) throw tooLarge("uncompressed size");
    const text = data.toString("utf8");
    cache.set(name, text);
    return text;
  };
}

// Every <tag ...>inner</tag> or <tag .../> in order, found with indexOf: linear in the input. An element whose closing
// tag is missing makes the part invalid (instead of a rescan to the end from every opening tag).
function* elements(xml: string, tag: string): Generator<{ attrs: string; inner: string }> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let at = 0;
  for (;;) {
    const start = xml.indexOf(open, at);
    if (start < 0) return;
    const after = xml[start + open.length];
    if (after !== ">" && after !== "/" && after !== " " && after !== "\t" && after !== "\n" && after !== "\r") { at = start + open.length; continue; }
    const end = xml.indexOf(">", start);
    if (end < 0) throw invalid(`unclosed <${tag}>`);
    const attrs = xml.slice(start + open.length, xml[end - 1] === "/" ? end - 1 : end);
    if (xml[end - 1] === "/") { yield { attrs, inner: "" }; at = end + 1; continue; }
    const stop = xml.indexOf(close, end + 1);
    if (stop < 0) throw invalid(`unclosed <${tag}>`);
    const inner = xml.slice(end + 1, stop);
    if (inner.includes(open + " ") || inner.includes(open + ">")) throw invalid(`unclosed <${tag}>`); // nested = an open tag never closed
    yield { attrs, inner };
    at = stop + close.length;
  }
}
const first = (xml: string, tag: string) => elements(xml, tag).next().value?.inner;

const NAMED: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
const unescape = (s: string) => s.replace(/&(lt|gt|quot|apos|amp|#\d{1,8}|#x[0-9a-f]{1,8});/gi, (_, e: string) => {
  if (e[0] !== "#") return NAMED[e.toLowerCase()] ?? "";
  const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "\uFFFD" : String.fromCodePoint(cp);
});
const attr = (attrs: string, name: string) => {
  const key = ` ${name}="`;
  const at = (" " + attrs.replace(/[\t\n\r]/g, " ")).indexOf(key);
  if (at < 0) return "";
  const from = at - 1 + key.length;
  const to = attrs.indexOf('"', from);
  return unescape(attrs.slice(from, to < 0 ? attrs.length : to));
};
const texts = (xml: string) => {
  let out = "";
  for (const t of elements(xml, "t")) {
    out += unescape(t.inner);
    if (out.length > MAX_STRING_CHARS) throw tooLarge("a text cell is longer than Excel allows");
  }
  return out;
};

const BUILTIN_FORMATS: Record<number, string> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 14: "yyyy-mm-dd", 22: "yyyy-mm-dd hh:mm",
  37: "#,##0_);(#,##0)", 38: "#,##0_);[Red](#,##0)", 39: "#,##0.00_);(#,##0.00)", 40: "#,##0.00_);[Red](#,##0.00)",
};

// Displays a number the way Excel shows it for a format code, so read A transcribes what a person would see. Follows
// Excel's rules: up to four sections (positive;negative;zero;text) chosen by sign; quoted text and \x are literals;
// _x (padding) and *x (fill) render as nothing; [colour] and [$-locale] blocks are dropped ([$€-2] keeps its symbol);
// trailing commas divide by 1,000 each; % multiplies by 100. Date and time codes are recognised only outside literals.
type Token = { kind: "literal" | "code"; text: string };

function tokenize(section: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < section.length; i++) {
    const ch = section[i] ?? "";
    if (ch === '"') {
      const close = section.indexOf('"', i + 1);
      const stop = close < 0 ? section.length : close;
      tokens.push({ kind: "literal", text: section.slice(i + 1, stop) });
      i = stop;
    } else if (ch === "\\") {
      tokens.push({ kind: "literal", text: section[i + 1] ?? "" });
      i++;
    } else if (ch === "_" || ch === "*") {
      i++; // padding / fill character: no visible text
    } else if (ch === "[") {
      const close = section.indexOf("]", i);
      const block = section.slice(i + 1, close < 0 ? section.length : close);
      const currency = /^\$([^-]*)/.exec(block);
      if (currency?.[1]) tokens.push({ kind: "literal", text: currency[1] });
      if (/^(h+|m+|s+)$/i.test(block)) tokens.push({ kind: "code", text: block }); // elapsed time [h]
      i = close < 0 ? section.length : close;
    } else if (/[$\-+/():!^&'~{}<>= ]/.test(ch)) {
      tokens.push({ kind: "literal", text: ch }); // characters Excel shows without quotes
    } else {
      tokens.push({ kind: "code", text: ch });
    }
  }
  return tokens;
}

function splitSections(code: string): string[] {
  const sections: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i] ?? "";
    if (ch === '"') quoted = !quoted;
    if (ch === "\\" && !quoted) { current += ch + (code[i + 1] ?? ""); i++; continue; }
    if (ch === ";" && !quoted) { sections.push(current); current = ""; continue; }
    current += ch;
  }
  return [...sections, current];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatDate(value: number, tokens: Token[]): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000));
  if (!Number.isFinite(date.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  // Runs of the same date letter ("yyyy", "mm", "d") are one code; anything else is shown as is.
  const runs: Token[] = [];
  for (const t of tokens) {
    const prev = runs.at(-1);
    if (t.kind === "code" && /[ymdhs]/i.test(t.text) && prev?.kind === "code" && prev.text[0]?.toLowerCase() === t.text.toLowerCase()) prev.text += t.text;
    else runs.push({ ...t });
  }
  const letters = runs.filter((r) => r.kind === "code" && /^[ymdhs]/i.test(r.text));
  return runs.map((r) => {
    if (r.kind === "literal" || !/^[ymdhs]/i.test(r.text)) return r.text;
    const run = r.text.toLowerCase();
    const at = letters.indexOf(r);
    switch (run[0]) {
      case "y": return run.length <= 2 ? pad(date.getUTCFullYear() % 100) : String(date.getUTCFullYear());
      case "d": return run.length === 1 ? String(date.getUTCDate()) : pad(date.getUTCDate());
      case "h": return run.length === 1 ? String(date.getUTCHours()) : pad(date.getUTCHours());
      case "s": return run.length === 1 ? String(date.getUTCSeconds()) : pad(date.getUTCSeconds());
      default: {
        // "m" is minutes right after an hour or right before seconds, otherwise the month.
        const minutes = run.length <= 2 && (letters[at - 1]?.text[0]?.toLowerCase() === "h" || letters[at + 1]?.text[0]?.toLowerCase() === "s");
        if (minutes) return run.length === 1 ? String(date.getUTCMinutes()) : pad(date.getUTCMinutes());
        const month = date.getUTCMonth();
        return run.length === 1 ? String(month + 1) : run.length === 2 ? pad(month + 1)
          : run.length === 3 ? (MONTHS[month] ?? "").slice(0, 3) : (MONTHS[month] ?? "");
      }
    }
  }).join("");
}

export function displayNumber(value: number, code: string): string {
  if (!Number.isFinite(value)) return String(value);
  const sections = splitSections(code);
  const general = (v: number) => String(Number(v.toPrecision(12)));
  // Section by sign: positive;negative;zero. A negative value shown with the first section gets a minus sign.
  const index = value < 0 && sections.length > 1 ? 1 : value === 0 && sections.length > 2 ? 2 : 0;
  const section = sections[index] ?? "";
  const minus = value < 0 && index === 0 ? "-" : "";
  const magnitude = Math.abs(value); // the negative section prints its own sign or parentheses
  const tokens = tokenize(section);
  const codes = tokens.filter((t) => t.kind === "code").map((t) => t.text).join("");

  if (/general/i.test(codes)) return (minus + general(magnitude)).trim();
  if (/[ymdhs]/i.test(codes.replace(/e[+-]/gi, ""))) return formatDate(value, tokens).trim();

  const placeholders = tokens.flatMap((t, i) => (t.kind === "code" && /[0#?]/.test(t.text) ? [i] : []));
  if (placeholders.length === 0) return tokens.map((t) => t.text).join("").trim(); // e.g. a "-" zero section
  const first = placeholders[0] ?? 0;
  const last = placeholders.at(-1) ?? 0;
  const numberCodes = tokens.slice(first, last + 1).filter((t) => t.kind === "code").map((t) => t.text).join("");
  let scaleCommas = 0;
  for (let i = last + 1; i < tokens.length && tokens[i]?.kind === "code" && tokens[i]?.text === ","; i++) scaleCommas++;
  const percents = codes.split("%").length - 1;
  const decimals = Math.min(/\.([0#?]*)/.exec(numberCodes)?.[1]?.length ?? 0, 20);
  const grouped = /[0#?],[0#?]/.test(numberCodes);
  const scaled = magnitude / 1000 ** scaleCommas * 100 ** percents;
  let digits = scaled.toFixed(decimals);
  if (grouped) digits = digits.replace(/^(\d+)/, (w) => w.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  if (!numberCodes.includes("0") && /^0(\.|$)/.test(digits) && !decimals) digits = digits.replace(/^0/, "");

  const text = (from: number, to: number) => tokens.slice(from, to)
    .map((t) => (t.kind === "literal" || t.text === "%" ? t.text : "")).join("");
  return `${minus}${text(0, first)}${digits}${text(last + 1 + scaleCommas, tokens.length)}`.trim();
}

export async function readSheets(bytes: Uint8Array): Promise<{ name: string; text: string }[]> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readPart = partReader(buf, centralDirectory(buf));
  const workbook = readPart("xl/workbook.xml");
  if (!workbook) throw invalid("no workbook part");
  const sheets = [...elements(workbook, "sheet")];
  if (sheets.length > MAX_SHEETS) throw tooLarge(`too many sheets: ${sheets.length}, at most ${MAX_SHEETS}`);

  const rels = new Map([...elements(readPart("xl/_rels/workbook.xml.rels") ?? "", "Relationship")]
    .map((r) => [attr(r.attrs, "Id"), attr(r.attrs, "Target")]));
  const shared = [...elements(readPart("xl/sharedStrings.xml") ?? "", "si")].map((si) => texts(si.inner));
  const styles = readPart("xl/styles.xml") ?? "";
  const custom = new Map([...elements(styles, "numFmt")].map((f) => [Number(attr(f.attrs, "numFmtId")), attr(f.attrs, "formatCode")]));
  const formatOf = [...elements(first(styles, "cellXfs") ?? "", "xf")].map((xf) => {
    const id = Number(attr(xf.attrs, "numFmtId") || 0);
    return custom.get(id) ?? BUILTIN_FORMATS[id] ?? "General";
  });

  let cells = 0;
  let chars = 0;
  return sheets.map((sheet) => {
    const target = rels.get(attr(sheet.attrs, "r:id")) ?? "";
    const xml = readPart(target.startsWith("/") ? target.slice(1) : `xl/${target}`) ?? "";
    const lines: string[] = [];
    for (const row of elements(first(xml, "sheetData") ?? "", "row")) {
      const shown: string[] = [];
      for (const cell of elements(row.inner, "c")) {
        if (++cells > MAX_CELLS) throw tooLarge(`more than ${MAX_CELLS} cells`);
        const type = attr(cell.attrs, "t");
        const v = first(cell.inner, "v");
        const text = type === "inlineStr" ? texts(cell.inner)
          : type === "s" ? shared[Number(v)] ?? ""
          : type === "b" ? (v === "1" ? "TRUE" : "FALSE")
          : type === "str" || type === "e" ? unescape(v ?? "")
          : v === undefined ? "" : displayNumber(Number(v), formatOf[Number(attr(cell.attrs, "s") || 0)] ?? "General");
        if (text !== "") shown.push(`${attr(cell.attrs, "r")}: ${text}`);
      }
      if (shown.length === 0) continue;
      const line = shown.join(" | ");
      chars += line.length + 1;
      if (chars > MAX_OUTPUT_CHARS) throw tooLarge(`more than ${MAX_OUTPUT_CHARS} characters of text`);
      lines.push(line);
    }
    return { name: attr(sheet.attrs, "name"), text: lines.join("\n") };
  });
}
