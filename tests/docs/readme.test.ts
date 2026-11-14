import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/dev-corpus.ts";

// SPEC-public-release W3 and success criterion 8: the README for the 90-second reader.
const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
const prose = readme.replace(/```[\s\S]*?```/g, ""); // the diagram's source is not prose
const headings = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1] ?? "");

describe("README.md", () => {
  it("has the spec's sections, in its order", () => {
    const wanted = [/^The problem/, /^How it works/, /^Eval results/, /^How it was built/, /^Run it/, /^What I would do next/];
    const found = wanted.map((w) => headings.findIndex((h) => w.test(h)));
    expect(found.every((i) => i >= 0), headings.join(" | ")).toBe(true);
    expect([...found].sort((a, b) => a - b)).toEqual(found);
  });

  it("shows the review screen as a GIF under 3 MB, right after the problem", () => {
    const gif = readme.match(/!\[[^\]]+\]\((docs\/media\/[\w-]+\.gif)\)/)?.[1];
    expect(gif).toBeDefined();
    expect(statSync(path.join(ROOT, gif ?? "")).size).toBeLessThan(3 * 1024 * 1024);
    expect(readme.indexOf(gif ?? "")).toBeGreaterThan(readme.indexOf("## The problem"));
    expect(readme.indexOf(gif ?? "")).toBeLessThan(readme.indexOf("## How it works"));
  });

  it("draws the architecture as a diagram GitHub renders", () => {
    expect(readme).toMatch(/```mermaid\n(flowchart|graph) /);
  });

  it("names n and the split wherever it gives an eval score", () => {
    const scored = prose.split("\n").filter((l) => !l.startsWith("|") && /\d%|\d+ unsafe auto-post/i.test(l)); // a score, not a rule
    expect(scored.length).toBeGreaterThan(0);
    for (const line of scored) expect(line, line).toMatch(/(dev|held-out)[^\n]*n=\d+|n=\d+[^\n]*(dev|held-out)/);
    const tables = (prose.match(/^\|.*\|$(\n^\|.*\|$)+/gm) ?? []).filter((t) => /\d%/.test(t));
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(table.split("\n")[0], table).toMatch(/dev[^|]*n=\d+.*held-out[^|]*n=\d+/); // a row's header names both
  });

  it("names Claude Code, and uses no em dash and no marketing adjective", () => {
    expect(readme).toContain("Claude Code");
    expect(prose).not.toContain("—");
    expect(prose).not.toMatch(/\b(powerful|seamless(ly)?|cutting[- ]edge|robust|revolutionary|state[- ]of[- ]the[- ]art|best[- ]in[- ]class|innovative|world[- ]class|effortless(ly)?|blazing|game[- ]chang\w*|next[- ]gen\w*|enterprise[- ]grade|leverag\w*)\b/i);
  });

  it("links only to files that exist in the repository", () => {
    const links = [...readme.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)].map((m) => m[1] ?? "").filter((l) => !/^[a-z]+:/.test(l));
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) expect(existsSync(path.join(ROOT, link)), link).toBe(true);
  });
});

describe("LICENSE", () => {
  it("is MIT, held by the author", () => {
    const licence = readFileSync(path.join(ROOT, "LICENSE"), "utf8");
    expect(licence).toMatch(/^MIT License\n\nCopyright \(c\) 2026 Gabriele Bosi\n/);
  });
});
