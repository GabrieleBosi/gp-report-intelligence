// Error analysis (SPEC-evals): each wrong value is attributed to the earliest sketch step whose output already disagrees
// with the label, so effort goes to the cheapest fix. Pure: the runner supplies the evidence for one value.
export type ValueEvidence = {
  expected: number | null;
  printedForms: string[]; // how the label value is printed in this report (the GP's number style)
  pageText: string; // the parsed text of the page the label cites (text layer, OCR or sheet)
  round0Raw: string | null; // what step 4 read
  round0Value: number | null; // what step 5 made of it
  row?: string; // a company figure: only the lines that name the company count
  // the final value (after the critic) is known to be wrong when attribute() is called
};

const squash = (s: string) => s.replace(/\s+/g, " ");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The printed value as a whole number: not part of a longer number, a percentage or a multiple ("17.5" is not in "17.5%").
const printedIn = (text: string, printed: string) =>
  new RegExp(`(^|[^0-9.,])${escape(squash(printed))}(?![0-9%x]|[.,][0-9])`).test(squash(text));
const same = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)));

export function attribute(v: ValueEvidence): 3 | 4 | 5 | 6 {
  const lines = v.row ? v.pageText.split("\n").filter((l) => squash(l).includes(squash(v.row ?? ""))) : [v.pageText];
  const text = lines.join("\n");
  if (!v.printedForms.some((p) => printedIn(text, p))) return 3; // the value never reached the text
  if (same(v.round0Value, v.expected)) return 6; // right after steps 4-5, wrong at the end: the critic
  if (v.round0Raw !== null && v.printedForms.includes(v.round0Raw.trim())) return 5; // read right, normalized wrong
  return 4; // read wrong from correct text
}

// A wrong route: classify (2) when the classification is wrong, confidence (7) when every key figure is right; otherwise
// the route follows from wrong values, which are attributed one by one.
export function attributeRoute(r: { routeOk: boolean; keyFiguresRight: boolean; classificationOk: boolean }): 2 | 7 | null {
  if (r.routeOk) return null;
  if (!r.classificationOk) return 2;
  return r.keyFiguresRight ? 7 : null;
}
