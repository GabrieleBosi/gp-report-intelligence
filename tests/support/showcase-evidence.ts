// Shared by the showcase tests: an evidence link must point at something real (SPEC-showcase: every claim links to
// evidence). Spec headings exist, files exist and are rendered in the app, runs are demo runs, hrefs are app routes.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { DEMO_RUNS, hrefFor, isArtifact, type Evidence } from "../../src/showcase/content.ts";
import { ROOT } from "./dev-corpus.ts";

const APP_ROUTES = [/^\/$/, /^\/review$/, /^\/portfolio$/, /^\/about$/, /^\/tour$/, /^\/evals$/, /^\/decisions$/,
  /^\/process$/, /^\/runs\/[0-9a-f-]{36}$/, /^\/docs\/[\w./+-]+(#[\w-]+)?$/];

export function checkEvidence(e: Evidence) {
  if (e.kind === "run") expect(DEMO_RUNS, `demo run ${e.run}`).toHaveProperty(e.run);
  if (e.kind === "page") expect(APP_ROUTES.some((r) => r.test(e.path)), `route ${e.path}`).toBe(true);
  if (e.kind === "doc" || e.kind === "test") {
    expect(existsSync(path.join(ROOT, e.file)), `file ${e.file}`).toBe(true);
    expect(isArtifact(e.file), `${e.file} is rendered in the app`).toBe(true);
  }
  if (e.kind === "doc" && e.heading) {
    expect(readFileSync(path.join(ROOT, e.file), "utf8"), `heading "${e.heading}" in ${e.file}`)
      .toMatch(new RegExp(`^#{1,4} ${e.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
  expect(APP_ROUTES.some((r) => r.test(hrefFor(e))), `href ${hrefFor(e)}`).toBe(true);
}
