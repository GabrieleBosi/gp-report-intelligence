import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARTIFACT_GLOBS, artifactGroups, docTitle, isArtifact, PROCESS_STEPS } from "../../src/showcase/content.ts";
import { ciSummary, commitsByDay, commitTypes } from "../../src/showcase/facts.ts";
import { ROOT } from "../support/dev-corpus.ts";
import { checkEvidence } from "../support/showcase-evidence.ts";

const tracked = () => execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const globRegex = (glob: string) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "(?:.+/)?").replace(/\*/g, "[^/]*")}$`);

describe("the documents rendered in the app", () => {
  it("loads exactly the files isArtifact allows: nothing linkable is missing, nothing else is bundled", () => {
    const byGlob = tracked().filter((f) => ARTIFACT_GLOBS.some((g) => globRegex(g).test(f)));
    expect(byGlob).toEqual(tracked().filter(isArtifact));
    expect(byGlob.length).toBeGreaterThan(100);
  });

  it("uses the same globs in the Vite loader (import.meta.glob needs literals, so this keeps them in sync)", () => {
    const loader = readFileSync(path.join(ROOT, "src/showcase/artifacts.ts"), "utf8");
    for (const glob of ARTIFACT_GLOBS) expect(loader).toContain(`"../../${glob}"`);
  });

  it("files every document under exactly one group of the process page", () => {
    const files = tracked().filter(isArtifact);
    const groups = artifactGroups(files);
    expect(groups.flatMap((g) => g.files).sort()).toEqual([...files].sort());
    expect(groups.map((g) => g.title)).toEqual([
      "Capability map and specs", "Plans and task lists", "Architecture decisions", "Error analyses", "Security",
      "Acceptance reports", "Eval reports and experiments", "Tests",
    ]);
    expect(groups[0]?.files[0]).toBe("CAPABILITY-MAP.md");
    expect(groups[0]?.files).toHaveLength(10);
  });

  it("titles a document by its first heading, or by its file name", () => {
    expect(docTitle("SPEC-evals.md", "# Spec: evals\n\nModule id")).toBe("Spec: evals");
    expect(docTitle("tests/core/llm.test.ts", "import x")).toBe("llm.test.ts");
  });
});

describe("the process page", () => {
  it("walks the agent-skills flow, each step with a real example", () => {
    expect(PROCESS_STEPS.map((s) => s.name)).toEqual(["Capability map", "Spec", "Plan and tasks", "Build, test first", "Review", "Ship and accept"]);
    PROCESS_STEPS.forEach((s) => checkEvidence(s.example));
  });
});

describe("build facts", () => {
  it("counts commits by conventional type, with anything else as 'other'", () => {
    expect(commitTypes(["feat(x): a", "feat: b", "fix(y): c", "revert(pipeline): d", "docs: e", "Initial commit"]))
      .toEqual({ feat: 2, fix: 1, revert: 1, docs: 1, other: 1 });
  });

  it("counts commits per day, on the author's own calendar day, in date order", () => {
    const byDay = commitsByDay(["2026-10-11T00:30:00+02:00", "2026-10-10T19:51:30+02:00", "2026-10-11T18:07:26+02:00", "2026-10-26T14:17:28+01:00"]);
    expect(Object.entries(byDay)).toEqual([["2026-10-10", 1], ["2026-10-11", 2], ["2026-10-26", 1]]);
  });

  it("separates the deliberate gate-proof failures from real failures on main, and how fast each was fixed", () => {
    const run = (conclusion: string, headBranch: string, createdAt: string) => ({ conclusion, headBranch, createdAt });
    expect(ciSummary([
      run("success", "main", "2026-10-11T07:00:00Z"), run("failure", "main", "2026-10-11T07:14:07Z"),
      run("success", "main", "2026-10-11T07:15:30Z"), run("failure", "proof/eval-gate", "2026-10-11T13:30:56Z"),
      run("failure", "main", "2026-10-11T10:36:11Z"), run("success", "main", "2026-10-11T10:38:05Z"),
      run("failure", "main", "2026-10-11T18:00:00Z"),
    ])).toEqual({ runs: 7, success: 3, failure: 4, failedProof: 1, failedMain: 3, mainFixedWithinMinutes: 2, mainUnfixed: 1 });
  });
});
