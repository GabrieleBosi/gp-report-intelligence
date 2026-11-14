import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/dev-corpus.ts";

// SPEC-public-release W3: the README's held-out numbers come from a command anyone can run from the repository. The
// held-out answers were recorded once on the live site (T7); replaying them costs $0. The split is measured, never
// gated or tuned on, so the command writes no report and no baseline.
describe("npm run eval:heldout", () => {
  it("replays all 6 held-out documents and prints their scores, leaving the reports alone", () => {
    const reports = () => readdirSync(path.join(ROOT, "evals/reports")).sort();
    const before = reports();
    const out = execFileSync(process.execPath, ["scripts/eval.ts", "--heldout"], { cwd: ROOT, encoding: "utf8" });
    expect(out).toMatch(/^Held-out split, replayed/);
    expect(out).toMatch(/\| Documents \| 6 \|/);
    expect(out).toMatch(/\| Unsafe auto-posts \| 0 \|/);
    expect(out).toMatch(/\| Key-figure accuracy \| 100\.0% \|/);
    expect(out).toMatch(/\| Route accuracy \| 100\.0% \|/);
    expect(reports()).toEqual(before);
  }, 60_000);
});
