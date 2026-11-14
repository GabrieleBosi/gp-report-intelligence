import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../support/dev-corpus.ts";

// CI on the public repository (SPEC-public-release W2 and success criterion 4).
const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

describe("the CI workflow", () => {
  it("pins every action to a full commit hash, so a moved tag cannot change what runs", () => {
    const uses = [...ci.matchAll(/^\s*- uses: (\S+)/gm)].map((m) => m[1] ?? "");
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action, action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("scans the full history for secrets with gitleaks, read-only", () => {
    expect(ci).toMatch(/secrets:\n(.*\n)*?\s+fetch-depth: 0\n\s+- uses: gitleaks\/gitleaks-action@[0-9a-f]{40}/);
    expect(ci).toMatch(/^permissions:\n\s+contents: read$/m);
  });

  it("runs every gate: typecheck, lint, tests, build and the eval gate", () => {
    for (const step of ["npm run typecheck", "npm run lint", "npm test", "npm run build", "npm run eval"]) expect(ci).toContain(`- run: ${step}`);
  });
});
