// Step 5 (normalize): the LLM returns numbers exactly as printed; this module turns them into values. Pure code, so
// every unit, sign and locale rule is tested exhaustively. Anything ambiguous is an error that step 7 surfaces,
// never a guess.
import { err, ok, type Result } from "../result.ts";

export type Separators = { thousands: string; decimal: string };

const NOT_STATED = /^(n\/?a|n\.a\.|nm|n\.m\.|[-–—])$/i;
const CURRENCY = /\b(EUR|USD|CHF|GBP|SEK|NOK|DKK)\b|[€$£]/gi;
const FOOTNOTE = /\s*(\[\d+\]|[¹²³⁴⁵⁶⁷⁸⁹⁰*†‡]+)$/u;
const GROUP_MARKS = /[.,' \u00a0\u202f]/g; // dot, comma, apostrophe, space, no-break space, narrow no-break space
const SUFFIX_SCALE: Record<string, number> = { k: 1e3, m: 1e6, mn: 1e6, bn: 1e9 };

const SCALE_WORDS: Record<string, number> = {
  bn: 1e9, billion: 1e9, billions: 1e9, mrd: 1e9,
  m: 1e6, mn: 1e6, mm: 1e6, mio: 1e6, million: 1e6, millions: 1e6,
  k: 1e3, t: 1e3, thousand: 1e3, thousands: 1e3, tsd: 1e3,
};

// "All amounts in EUR m" -> 1e6, "TEUR" -> 1e3, "USD" -> 1. Currency words are removed first, so glued forms
// ("TEUR", "kEUR", "EURm", "€m") leave their scale letter behind as a token.
export function scaleFromUnitStatement(statement: string | null): Result<number> {
  if (!statement?.trim()) return ok(1);
  const tokens = statement.toLowerCase()
    .replace(/eur(o|os)?|usd|chf|gbp|sek|nok|dkk|dollars?|francs?|[€$£]/g, " ")
    .split(/[^a-z]+/).filter(Boolean);
  const scales = new Set(tokens.flatMap((t) => (t in SCALE_WORDS ? [SCALE_WORDS[t] as number] : [])));
  if (scales.size > 1) return err("ambiguous_unit", `unit statement "${statement}" names more than one scale`);
  return ok([...scales][0] ?? 1);
}

type Cleaned = { kind: "not_stated" } | { kind: "number"; body: string; negative: boolean; suffixScale?: number };

function clean(raw: string): Cleaned {
  let s = raw.trim();
  if (s === "" || NOT_STATED.test(s)) return { kind: "not_stated" };
  s = s.replace(FOOTNOTE, "").replace(CURRENCY, "").trim();

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (/^[-−–]/.test(s)) { negative = true; s = s.slice(1).trim(); }
  if (/\d-$/.test(s)) { negative = true; s = s.slice(0, -1); }

  const suffix = /^(.*\d)\s*(k|m|mn|bn)$/i.exec(s);
  if (suffix?.[1] && suffix[2]) {
    return { kind: "number", body: suffix[1], negative, suffixScale: SUFFIX_SCALE[suffix[2].toLowerCase()] };
  }
  return { kind: "number", body: s, negative };
}

const normalizeMark = (mark: string) => (/\s/.test(mark) ? " " : mark);

// Reads the document's number style from all its amounts. Evidence per mark: a mark followed by anything but
// exactly 3 digits at the end of a number is a decimal; a mark used twice in one number, or before a different
// final mark, groups thousands; a mark only ever followed by exactly 3 digits is taken as a thousands separator
// (fund reports in thousands print "400.000", not three-decimal amounts).
export function detectSeparators(raws: string[]): Result<Separators> {
  const decimalVotes = new Set<string>();
  const thousandsVotes = new Set<string>();
  const groupOnly = new Set<string>();

  for (const raw of raws) {
    const cleaned = clean(raw);
    if (cleaned.kind !== "number" || !/^\d[\d.,' \u00a0\u202f]*\d$|^\d$/.test(cleaned.body)) continue;
    const marks = [...cleaned.body.matchAll(GROUP_MARKS)].map((m) => ({ mark: normalizeMark(m[0]), index: m.index }));
    const last = marks.at(-1);
    if (!last) continue;
    const digitsAfterLast = cleaned.body.length - last.index - 1;

    marks.forEach(({ mark }, i) => {
      const isLast = i === marks.length - 1;
      if (marks.filter((m) => m.mark === mark).length > 1) thousandsVotes.add(mark);
      else if (!isLast && mark !== last.mark) thousandsVotes.add(mark);
    });
    const lastIsUnique = marks.filter((m) => m.mark === last.mark).length === 1;
    if (lastIsUnique && digitsAfterLast !== 3) decimalVotes.add(last.mark);
    else if (lastIsUnique && marks.length > 1) decimalVotes.add(last.mark);
    else if (lastIsUnique) groupOnly.add(last.mark);
  }

  const conflict = [...decimalVotes].find((m) => thousandsVotes.has(m));
  if (conflict) return err("ambiguous_separators", `"${conflict}" is a decimal mark in one number and a group mark in another`);
  if (decimalVotes.size > 1) return err("ambiguous_separators", `several decimal marks: ${[...decimalVotes].join(" ")}`);

  const decimal = [...decimalVotes][0];
  for (const mark of groupOnly) if (mark !== decimal) thousandsVotes.add(mark);
  if (thousandsVotes.size > 1) return err("ambiguous_separators", `several group marks: ${[...thousandsVotes].join(" ")}`);
  const thousands = [...thousandsVotes][0];

  if (decimal && thousands) return ok({ thousands, decimal });
  if (decimal) return ok({ thousands: decimal === "," ? "." : ",", decimal });
  if (thousands) return ok({ thousands, decimal: thousands === "." ? "," : "." });
  return ok({ thousands: ",", decimal: "." });
}

export function normalizeAmount(raw: string, scale: number, separators: Separators): Result<number | null> {
  const cleaned = clean(raw);
  if (cleaned.kind === "not_stated") return ok(null);

  const body = cleaned.body.replace(/[\u00a0\u202f]/g, " ");
  const [integerPart = "", fractionPart, ...rest] = body.split(separators.decimal);
  const groups = integerPart.split(separators.thousands);
  const validGroups = groups.every((g, i) => /^\d+$/.test(g) && (i === 0 ? g.length <= 3 || groups.length === 1 : g.length === 3));
  if (rest.length > 0 || !validGroups || (fractionPart !== undefined && !/^\d+$/.test(fractionPart))) {
    return err("unparseable_amount", `cannot read "${raw}" as a number`);
  }

  const digits = groups.join("") + (fractionPart === undefined ? "" : `.${fractionPart}`);
  const magnitude = Number(digits) * (cleaned.suffixScale ?? scale);
  const rounded = Math.round(magnitude * 100) / 100; // cents: removes floating-point noise such as 0.3 * 1e6
  return ok(cleaned.negative && rounded !== 0 ? -rounded : rounded);
}

// Ratios never carry thousands separators, so either "1.40x" or "1,40x" is unambiguous on its own.
export function normalizeRatio(raw: string): Result<number | null> {
  const s = raw.trim();
  if (s === "" || NOT_STATED.test(s)) return ok(null);
  const digits = s.replace(/\s*[x×X]$/u, "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(digits)) return err("unparseable_ratio", `cannot read "${raw}" as a multiple`);
  return ok(Number(digits));
}

export function normalizePercent(raw: string): Result<number | null> {
  let s = raw.trim();
  if (s === "" || NOT_STATED.test(s)) return ok(null);
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (/^[-−–]/.test(s)) { negative = true; s = s.slice(1).trim(); }
  const digits = s.replace(/\s*%$/, "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(digits)) return err("unparseable_percent", `cannot read "${raw}" as a percentage`);
  const fraction = Number((Number(digits) / 100).toFixed(10));
  return ok(negative ? -fraction : fraction);
}
