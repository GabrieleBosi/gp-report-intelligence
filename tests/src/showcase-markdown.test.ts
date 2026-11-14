import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DECISION_SOURCES, decisionGroups } from "../../src/showcase/decisions.ts";
import { renderMarkdown, resolveLink } from "../../src/showcase/markdown.ts";
import { ROOT } from "../support/dev-corpus.ts";

describe("resolveLink", () => {
  it("turns a link to one of the repository's documents into an in-app link, relative to the linking file", () => {
    expect(resolveLink("SPEC-evals.md", "SPEC-review.md")).toEqual({ kind: "internal", to: "/docs/SPEC-evals.md" });
    expect(resolveLink("../../evals/reports/x.md", "docs/acceptance/a.md")).toEqual({ kind: "internal", to: "/docs/evals/reports/x.md" });
    expect(resolveLink("../SPEC-evals.md#runner-and-gate", "tasks/plan.md")).toEqual({ kind: "internal", to: "/docs/SPEC-evals.md#runner-and-gate" });
    expect(resolveLink("#decisions", "SPEC-evals.md")).toEqual({ kind: "internal", to: "/docs/SPEC-evals.md#decisions" });
  });

  it("opens web links outside the app, and leaves everything else as text", () => {
    expect(resolveLink("https://example.com/x", "SPEC-evals.md")).toEqual({ kind: "external", href: "https://example.com/x" });
    for (const href of ["2026-10-11-heldout.json", "../../core/llm.ts", "../../.env", "../../../etc/passwd", "mailto:a@b.c", "javascript:alert(1)"]) {
      expect(resolveLink(href, "docs/acceptance/a.md"), href).toEqual({ kind: "none" });
    }
  });
});

describe("renderMarkdown", () => {
  it("renders links by kind: in-app, external in a new tab, or plain text", () => {
    const html = renderMarkdown("See [evals](SPEC-evals.md), [web](https://example.com) and [raw](data.json).", "SPEC-review.md", { inline: true });
    expect(html).toBe('See <a href="/docs/SPEC-evals.md">evals</a>, <a href="https://example.com" target="_blank" rel="noopener noreferrer">web</a> and raw.');
  });

  it("gives headings the anchor ids the evidence links use", () => {
    expect(renderMarkdown("## Runner and gate\n\ntext", "SPEC-evals.md")).toContain('<h2 id="runner-and-gate">Runner and gate</h2>');
    expect(renderMarkdown("## Security & guardrails", "SPEC-platform.md")).toContain('id="security-guardrails"');
  });

  it("shows raw HTML as text instead of passing it through (review finding: '<analyst>' vanished in SPEC-posting)", () => {
    expect(renderMarkdown("approved by <analyst> with the reason", "SPEC-posting.md", { inline: true }))
      .toBe("approved by &lt;analyst&gt; with the reason");
    expect(renderMarkdown("<script>alert(1)</script>", "x.md")).not.toContain("<script>");
  });

  it("renders block markdown (tables, lists, code) and inline markdown without a paragraph", () => {
    expect(renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |", "x.md")).toContain("<table>");
    expect(renderMarkdown("**bold** and `code`", "x.md", { inline: true })).toBe("<strong>bold</strong> and <code>code</code>");
  });
});

describe("decisionGroups", () => {
  it("groups the decisions by spec, in the capability map's order, leaving out specs without any", () => {
    const sources = Object.fromEntries(DECISION_SOURCES.map((f) => [f, readFileSync(path.join(ROOT, f), "utf8")]));
    const groups = decisionGroups(sources);
    expect(groups.map((g) => g.module)).toEqual(["capability map", "corpus", "pipeline", "confidence", "review", "posting", "evals", "showcase", "public-release"]);
    expect(groups.reduce((n, g) => n + g.decisions.length, 0)).toBe(44);
  });
});
