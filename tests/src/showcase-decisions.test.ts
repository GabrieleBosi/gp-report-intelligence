import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DECISION_SOURCES, parseDecisions } from "../../src/showcase/decisions.ts";
import { ROOT } from "../support/dev-corpus.ts";

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const all = () => DECISION_SOURCES.flatMap((file) => parseDecisions(file, read(file)));

describe("parseDecisions", () => {
  it.each([
    ["CAPABILITY-MAP.md", 5], ["SPEC-platform.md", 0], ["SPEC-corpus.md", 4], ["SPEC-pipeline.md", 5],
    ["SPEC-confidence.md", 7], ["SPEC-review.md", 4], ["SPEC-posting.md", 4], ["SPEC-evals.md", 6],
    ["SPEC-showcase.md", 4], ["SPEC-public-release.md", 5],
  ])("finds every decision recorded in %s (%i)", (file, count) => {
    expect(parseDecisions(file, read(file))).toHaveLength(count);
  });

  it("reads every spec of the capability map, so a new spec cannot be left out silently", () => {
    const specs = read("CAPABILITY-MAP.md").match(/SPEC-[a-z-]+\.md/g) ?? [];
    expect(new Set(DECISION_SOURCES)).toEqual(new Set(["CAPABILITY-MAP.md", ...specs]));
  });

  it("takes the title from the leading bold text, or from the text before the first colon", () => {
    const [first] = parseDecisions("CAPABILITY-MAP.md", read("CAPABILITY-MAP.md"));
    expect(first).toMatchObject({ module: "capability map", number: 1, title: "Scope and timeline", date: "2026-10-10" });

    const policy3 = parseDecisions("SPEC-confidence.md", read("SPEC-confidence.md")).find((d) => d.number === 7);
    expect(policy3).toMatchObject({ module: "confidence", date: "2026-10-11" });
    expect(policy3?.title).toMatch(/^policy@3/);
    expect(policy3?.text).toMatch(/held-out/);
  });

  it("dates a decision by its own date, else its section's, else the previous decision's, else the spec status", () => {
    const corpus = parseDecisions("SPEC-corpus.md", read("SPEC-corpus.md"));
    expect(corpus.map((d) => d.date)).toEqual(["2026-10-11", "2026-10-11", "2026-10-11", "2026-10-11"]);
    expect(parseDecisions("SPEC-review.md", read("SPEC-review.md")).every((d) => d.date === "2026-10-11")).toBe(true);
  });

  it("joins wrapped lines and points each decision at its section as evidence", () => {
    for (const d of all()) {
      expect(d.title.length).toBeGreaterThan(0);
      expect(`${d.title} ${d.text}`).not.toMatch(/\n/);
      expect(d.evidence.file).toBe(d.file);
      expect(read(d.file)).toContain(`## ${d.evidence.heading}`);
    }
    expect(all()).toHaveLength(44);
  });

  it("handles a synthetic spec: numbered, bulleted and dated items, and stops at the next section", () => {
    const md = [
      "# Spec: x", "", "Module id: `x` · Status: **approved** 2026-10-01", "",
      "## Decisions (approved 2026-10-02)", "1. **Alpha:** first", "   continued.", "2. **Beta (2026-10-05):** second", "",
      "## Changes during build", "- **Gamma:** third", "",
      "## Something else", "1. **Not a decision:** ignored",
    ].join("\n");

    expect(parseDecisions("SPEC-x.md", md)).toEqual([
      { file: "SPEC-x.md", module: "x", number: 1, title: "Alpha", text: "first continued.", date: "2026-10-02",
        evidence: { file: "SPEC-x.md", heading: "Decisions (approved 2026-10-02)" } },
      { file: "SPEC-x.md", module: "x", number: 2, title: "Beta (2026-10-05)", text: "second", date: "2026-10-05",
        evidence: { file: "SPEC-x.md", heading: "Decisions (approved 2026-10-02)" } },
      { file: "SPEC-x.md", module: "x", number: 3, title: "Gamma", text: "third", date: "2026-10-05",
        evidence: { file: "SPEC-x.md", heading: "Changes during build" } },
    ]);
  });
});
