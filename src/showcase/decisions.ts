// The product owner's decisions, parsed from the specs (SPEC-showcase: the decisions page cannot drift from them).
// A decision is an item of a "## Decisions…" section or of "## Changes during build" (decisions taken while building).

export const DECISION_SOURCES = [
  "CAPABILITY-MAP.md", "SPEC-platform.md", "SPEC-corpus.md", "SPEC-pipeline.md", "SPEC-confidence.md",
  "SPEC-review.md", "SPEC-posting.md", "SPEC-evals.md", "SPEC-showcase.md", "SPEC-public-release.md",
] as const;

export type Decision = {
  file: string;
  module: string;
  number: number;
  title: string;
  text: string;
  date: string;
  evidence: { file: string; heading: string };
};

const DATE = /\d{4}-\d{2}-\d{2}/;
const DECISION_SECTION = /^(Decisions\b.*|Changes during build)$/;
const ITEM = /^(?:\d+\.|-)\s+(.*)$/;

export function parseDecisions(file: string, markdown: string): Decision[] {
  const module = file === "CAPABILITY-MAP.md" ? "capability map" : file.replace(/^SPEC-|\.md$/g, "");
  const statusDate = markdown.match(/Status:\s*\*\*approved\*\*\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
  const decisions: Decision[] = [];
  let heading: string | null = null;
  let headingDate = "";
  let current: { body: string; heading: string; headingDate: string } | null = null;

  const flush = () => {
    if (!current) return;
    const { title, text } = split(current.body);
    const date = title.match(DATE)?.[0] || current.headingDate || decisions.at(-1)?.date || statusDate;
    decisions.push({ file, module, number: decisions.length + 1, title, text, date,
      evidence: { file, heading: current.heading } });
    current = null;
  };

  for (const line of markdown.split("\n")) {
    const section = line.match(/^## (.*)$/)?.[1];
    if (section !== undefined) {
      flush();
      heading = DECISION_SECTION.test(section) ? section : null;
      headingDate = section.match(DATE)?.[0] ?? "";
      continue;
    }
    if (heading === null) continue;
    const item = line.match(ITEM)?.[1];
    if (item !== undefined) {
      flush();
      current = { body: item, heading, headingDate };
    } else if (current && /^\s+\S/.test(line)) {
      current.body += ` ${line.trim()}`;
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  return decisions;
}

// "**Title:** text", "**Title.** text", "**Whole statement.**" or "Title: text".
function split(body: string): { title: string; text: string } {
  const [, boldTitle, rest = ""] = body.match(/^\*\*(.+?)\*\*\s*(.*)$/) ?? [];
  if (boldTitle !== undefined) return { title: tidy(boldTitle), text: rest.trim() };
  const colon = body.indexOf(":");
  return colon > 0 ? { title: body.slice(0, colon).trim(), text: body.slice(colon + 1).trim() } : { title: body, text: "" };
}

const tidy = (title: string) => title.trim().replace(/[:.]$/, "");

export type DecisionGroup = { file: string; module: string; decisions: Decision[] };

// The decisions page: one group per spec, in the capability map's order; specs without decisions are left out.
export function decisionGroups(sources: Record<string, string>): DecisionGroup[] {
  return DECISION_SOURCES.flatMap((file) => {
    const decisions = parseDecisions(file, sources[file] ?? "");
    return decisions.length > 0 ? [{ file, module: decisions[0]?.module ?? file, decisions }] : [];
  });
}
