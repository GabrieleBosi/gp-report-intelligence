// policy@2: the rules that decide what may be posted without a human (SPEC-confidence). Changing anything here changes
// what gets auto-posted, so bump `version` (it is stored with every assessment) and get approval first.
export const POLICY = {
  // policy@2 (2026-10-11, product owner): uploaded documents never auto-post. An upload names no fund, so a crafted file
  // printing another known fund's name could otherwise attach its figures to that fund (security audit).
  // policy@3 (2026-10-11, product owner): a footnote marker in either read keeps a key figure from auto-posting
  // (docs/error-analysis/2026-10-11-sonnet-restatement.md).
  version: "policy@3",
  uploadsAlwaysReviewed: true,
  fundKeyFigures: ["commitment", "paid_in", "distributions", "nav", "tvpi", "dpi"] as const,
  ratioKeyFigures: ["tvpi", "dpi"] as const,
  // Two transcriptions of the same printed multiple may differ only by rounding of the last digit.
  ratioTolerance: 0.005,
  // A trailing footnote marker: superscript digits, *, daggers, [n], or " (n)". A parenthesized amount such as
  // "(60.0)" is a negative number, not a footnote: the "(n)" form needs a space before it and a single digit.
  footnoteMarker: /([¹²³⁰-⁹*†‡]|\[\d+\]|\s\(\d\))\s*$/u,
} as const;

export type FundKeyFigure = (typeof POLICY.fundKeyFigures)[number];
