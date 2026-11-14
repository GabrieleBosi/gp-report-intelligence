// The analyst's self-declared name (SPEC-review decision 1): asked once, kept in this browser, sent with each decision.
const KEY = "review.analyst";

export function savedAnalyst(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}
export function saveAnalyst(name: string): void {
  try { localStorage.setItem(KEY, name.trim()); } catch { /* private mode: the name is simply asked again */ }
}
