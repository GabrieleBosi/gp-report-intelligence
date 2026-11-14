import { describe, expect, it } from "vitest";
import {
  DEMO_RUNS, hrefFor, IMPROVEMENT_LOOP, isArtifact, OVERVIEW, REQUIREMENTS, SKETCH_STEPS, TOURS,
} from "../../src/showcase/content.ts";
import { checkEvidence } from "../support/showcase-evidence.ts";

describe("showcase content", () => {
  it("rebuilds the sketch: steps 1-9 in order, each with who acts, the requirement, the choice and evidence", () => {
    expect(SKETCH_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const step of [...SKETCH_STEPS, IMPROVEMENT_LOOP]) {
      expect(["system", "ai", "analyst"]).toContain(step.actor);
      expect(step.title.length).toBeGreaterThan(0);
      for (const field of [step.does, step.requirement, step.choice]) expect(field.length).toBeGreaterThan(30);
      // success criterion 1: a spec section, tests and a live run for every step and for the loop
      expect(step.evidence.some((e) => e.kind === "doc" && e.heading), `${step.title}: spec section`).toBe(true);
      expect(step.evidence.some((e) => e.kind === "test"), `${step.title}: tests`).toBe(true);
      expect(step.evidence.some((e) => e.kind === "run"), `${step.title}: live run`).toBe(true);
      step.evidence.forEach(checkEvidence);
    }
  });

  it("opens with the case in three sentences and the three convictions, each with a link", () => {
    expect(OVERVIEW.case).toHaveLength(3);
    expect(OVERVIEW.convictions.map((c) => c.title)).toEqual(["Understood", "Disciplined", "Measured"]);
    OVERVIEW.convictions.forEach((c) => checkEvidence(c.link));
  });

  it("has three tour scenarios that fit in 10 minutes, every link resolving", () => {
    expect(TOURS).toHaveLength(3);
    expect(TOURS.reduce((sum, t) => sum + t.steps.reduce((s, x) => s + x.minutes, 0), 0)).toBeLessThanOrEqual(10);
    for (const tour of TOURS) {
      expect(tour.steps.length).toBeGreaterThan(1);
      tour.steps.forEach((s) => checkEvidence(s.link));
    }
  });

  it("maps business requirements to technical choices, each with evidence", () => {
    expect(REQUIREMENTS.length).toBeGreaterThanOrEqual(6);
    for (const r of REQUIREMENTS) {
      expect(r.evidence.length).toBeGreaterThan(0);
      r.evidence.forEach(checkEvidence);
    }
  });

  it("names demo runs by full id, and links a run to its run page", () => {
    for (const run of Object.values(DEMO_RUNS)) expect(run.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(hrefFor({ kind: "run", run: "cleanAutoPost" })).toBe(`/runs/${DEMO_RUNS.cleanAutoPost.id}`);
    expect(hrefFor({ kind: "doc", file: "SPEC-evals.md", heading: "Runner and gate" })).toBe("/docs/SPEC-evals.md#runner-and-gate");
  });

  it("renders only the repository's own documents and tests, never configuration or secrets", () => {
    expect(isArtifact("SPEC-evals.md")).toBe(true);
    expect(isArtifact("docs/adr/0001-pure-core-with-thin-adapters.md")).toBe(true);
    expect(isArtifact("tests/core/confidence/assess.test.ts")).toBe(true);
    expect(isArtifact("supabase/tests/posting.sql")).toBe(true);
    for (const f of [".env", "netlify.toml", "package.json", "core/llm.ts", "../SPEC-evals.md", "docs/../.env"]) {
      expect(isArtifact(f), f).toBe(false);
    }
  });
});
