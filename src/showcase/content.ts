// The showcase's words and links, as data (SPEC-showcase): reviewed like code, and every link is checked by
// tests/src/showcase-content.test.ts (spec headings exist, files exist and are rendered in the app, runs are demo runs).

// Runs that the tour and the sketch link to. Posted runs are final, so these links stay stable.
export const DEMO_RUNS = {
  cleanAutoPost: { id: "7bc2ccb5-5b9b-4315-9fa6-a7cc85df4bd9", label: "Alpenrose IV, Q1 2026: posted with no human step" },
  trap1Approved: { id: "0c3dac74-82ec-440a-8c8c-743a45b7e8ca", label: "Harbourline II, Q3 2025: the GP's TVPI misprint, approved by an analyst" },
  scanApproved: { id: "354450fc-8a84-49d4-aa30-f2fc02434dc7", label: "Harbourline II, Q3 2025, scanned: OCR, then reviewed" },
  xlsxAutoPost: { id: "cdaa99d1-f10b-41ad-8d67-44c1f04df238", label: "Meridian I, Q1 2026: an Excel workbook, posted" },
  restatementWrongV1: { id: "7a60e097-e9fe-4a23-8ac5-26e967c6b8e8", label: "Nordkap III, Q3 2025: auto-posted with the unrevised NAV (Sonnet experiment)" }, // (v1, superseded)
  restatementCorrectedV2: { id: "db8c283a-9589-4b88-b877-b8393947a471", label: "Nordkap III, Q3 2025: the footnote sends it to review; version 2 supersedes" },
  triageUnknownGp: { id: "5807a63b-c9c8-4a04-95ee-e167123834f2", label: "Tessera Seed I: a GP not in the registry, sent to triage" }, // a visitor may resolve it in their browser; a reload restores it, so the label stays true
} as const;

export type DemoRun = keyof typeof DEMO_RUNS;

export type Evidence =
  | { kind: "doc"; file: string; heading?: string; label?: string } // a spec, plan, ADR or report, rendered in the app
  | { kind: "test"; file: string; label?: string } // a test file, rendered in the app
  | { kind: "run"; run: DemoRun; label?: string } // a recorded run (in the snapshot on the public site)
  | { kind: "page"; path: string; label: string }; // a page of the app

// The overview page: the case, and the three things a reader should leave convinced of (SPEC-showcase, objective).
export const OVERVIEW: { case: string[]; convictions: { title: string; text: string; link: Evidence }[] } = {
  case: [
    "A private markets investor receives quarterly reports from many GPs: text PDFs, scans and spreadsheets, each in its own layout.",
    "Typing the fund and portfolio figures into the portfolio system by hand is slow, and a single wrong figure is costly.",
    "This system reads each report, checks it, and posts only what two independent signals agree on; everything else reaches an analyst with the reason.",
  ],
  convictions: [
    { title: "Understood", text: "My process sketch is the architecture: each of its steps serves a business requirement and is built as drawn.",
      link: { kind: "page", path: "/tour", label: "Take the 10-minute tour" } },
    { title: "Disciplined", text: "Spec, plan, tasks, test-first build, review, ship; every product decision recorded at a human gate.",
      link: { kind: "page", path: "/process", label: "How it was built" } },
    { title: "Measured", text: "A labelled golden set gates every change in CI; a held-out set caught an unsafe model switch before it could do lasting harm.",
      link: { kind: "page", path: "/evals", label: "Evals" } },
  ],
};

export type Actor = "system" | "ai" | "analyst";

export type SketchStep = {
  n: number;
  title: string;
  actor: Actor;
  does: string;
  requirement: string;
  choice: string;
  evidence: Evidence[];
};

// The process sketch, step by step.
export const SKETCH_STEPS: SketchStep[] = [
  {
    n: 1, title: "Receive and store the raw file", actor: "system",
    does: "Accepts a PDF (text or scanned) or an Excel workbook, stores the original untouched and records its hash.",
    requirement: "Every figure must be traceable to the exact file it came from, and nothing may be lost.",
    choice: "Private storage keyed by SHA-256; duplicates are recognized; uploads limited to 4 MB and checked by type.",
    evidence: [
      { kind: "doc", file: "SPEC-platform.md", heading: "Security & guardrails" },
      { kind: "test", file: "tests/core/upload.test.ts" },
      { kind: "test", file: "supabase/tests/platform.sql" },
      { kind: "run", run: "cleanAutoPost" },
    ],
  },
  {
    n: 2, title: "Classify", actor: "ai",
    does: "Identifies the GP, the fund, the reporting period, the currency and the report type.",
    requirement: "A report must land on the right fund, or on no fund at all.",
    choice: "The model matches against the fund registry; an unknown GP is never guessed, it goes to triage.",
    evidence: [
      { kind: "doc", file: "SPEC-pipeline.md", heading: "Step details" },
      { kind: "test", file: "tests/core/pipeline/classify.test.ts" },
      { kind: "run", run: "triageUnknownGp" },
    ],
  },
  {
    n: 3, title: "Parse / OCR", actor: "system",
    does: "Turns every page into text: the text layer when there is one, OCR for scans, cells for workbooks.",
    requirement: "Scanned reports from smaller GPs must work as well as clean PDFs.",
    choice: "pdf.js for text, Tesseract OCR at 200 dpi for scans, a dependency-free workbook reader; page images kept for review.",
    evidence: [
      { kind: "doc", file: "docs/adr/0004-page-rendering-and-ocr.md" },
      { kind: "doc", file: "SPEC-pipeline.md", heading: "Step details" },
      { kind: "test", file: "tests/core/pipeline/parse.test.ts" },
      { kind: "run", run: "scanApproved" },
    ],
  },
  {
    n: 4, title: "Extract per section to a JSON schema", actor: "ai",
    does: "Reads the fund figures and every portfolio company into a strict schema, each value with the string as printed and its page.",
    requirement: "Figures must be machine-readable and each one must point back to where it was printed.",
    choice: "Structured outputs validated against a Zod schema, one call per section, the printed string kept next to the value.",
    evidence: [
      { kind: "doc", file: "SPEC-pipeline.md", heading: "Step details" },
      { kind: "test", file: "tests/core/pipeline/extract.test.ts" },
      { kind: "run", run: "xlsxAutoPost" },
    ],
  },
  {
    n: 5, title: "Normalize and run rules", actor: "system",
    does: "Converts \"1.234,5\", \"(60.0)\" or \"€ 12m\" into numbers, then checks that the figures agree with each other.",
    requirement: "A number that is internally inconsistent must never pass silently.",
    choice: "Deterministic code: TVPI = (distributions + NAV) / paid-in, unfunded = commitment − paid-in, EBITDA ≤ revenue, quarter-on-quarter jumps.",
    evidence: [
      { kind: "doc", file: "SPEC-pipeline.md", heading: "Step details" },
      { kind: "test", file: "tests/core/pipeline/normalize.test.ts" },
      { kind: "run", run: "trap1Approved" },
    ],
  },
  {
    n: 6, title: "Critic re-reads the source (max 2 rounds)", actor: "ai",
    does: "When a check fails, a second pass re-reads the page with the failure in hand and may correct the reading.",
    requirement: "Reading errors should be fixed by the system before a person has to look.",
    choice: "A critic with the failed checks and the source, at most two rounds; it can fix a misreading, never the GP's own error.",
    evidence: [
      { kind: "doc", file: "SPEC-pipeline.md", heading: "Step details" },
      { kind: "test", file: "tests/core/pipeline/critic.test.ts" },
      { kind: "run", run: "restatementCorrectedV2" },
    ],
  },
  {
    n: 7, title: "Confidence high?", actor: "system",
    does: "Gives each key figure a level from two signals: do the checks pass, and does an independent second read agree.",
    requirement: "Post without a human only when a wrong figure is very unlikely; say why otherwise.",
    choice: "Read B looks at the page image (or the workbook cell), never at read A's values; a versioned policy routes to post, review or triage.",
    evidence: [
      { kind: "doc", file: "SPEC-confidence.md", heading: "The confidence matrix (per key figure)" },
      { kind: "doc", file: "docs/adr/0005-two-signal-confidence-policy.md" },
      { kind: "test", file: "tests/core/confidence/assess.test.ts" },
      { kind: "run", run: "restatementCorrectedV2" },
    ],
  },
  {
    n: 8, title: "Post via API and log", actor: "system",
    does: "Sends the cleared figures to the portfolio system (a mock here) and logs every attempt.",
    requirement: "Exactly once, versioned, and on whose authority: the policy or a named analyst.",
    choice: "Idempotency key = run id; a newer report creates version n+1 and keeps the old one; records are append-only.",
    evidence: [
      { kind: "doc", file: "SPEC-posting.md", heading: "Flows" },
      { kind: "test", file: "tests/core/posting/posting.test.ts" },
      { kind: "test", file: "supabase/tests/posting.sql" },
      { kind: "run", run: "cleanAutoPost" },
    ],
  },
  {
    n: 9, title: "Review: accept / fix / reject; unknown GP to triage", actor: "analyst",
    does: "The analyst sees each flagged figure next to the page it came from, with the reason it was flagged.",
    requirement: "Analysts spend time only where the system is unsure, and every decision is recorded.",
    choice: "One queue with the reasons on each item; accept, correct or reject per figure; approving a failed check needs a written reason.",
    evidence: [
      { kind: "doc", file: "SPEC-review.md", heading: "User flows" },
      { kind: "test", file: "tests/core/review/actions.test.ts" },
      { kind: "test", file: "e2e/review.spec.ts" },
      { kind: "run", run: "trap1Approved" },
    ],
  },
];

export const IMPROVEMENT_LOOP: Omit<SketchStep, "n"> = {
  title: "Improvement loop: golden set → error analysis → cheapest fix → eval gate → shadow → canary → ship", actor: "system",
  does: "Every change to a prompt, model, rule or policy is measured on a labelled golden set before it ships.",
  requirement: "The system must get better over time, and a change that makes it worse must not reach production.",
  choice: "Code-graded evals in CI (zero unsafe auto-posts is absolute), each error attributed to the first bad step, shadow runs for cheaper models, a held-out split never tuned on.",
  evidence: [
    { kind: "doc", file: "SPEC-evals.md", heading: "Runner and gate" },
    { kind: "doc", file: "docs/error-analysis/2026-10-11-sonnet-restatement.md" },
    { kind: "test", file: "tests/core/evals/evals.test.ts" },
    { kind: "run", run: "restatementCorrectedV2" },
  ],
};

export type TourStep = { text: string; minutes: number; link: Evidence };
export type Tour = { id: string; title: string; point: string; steps: TourStep[] };

// About 10 minutes for all three.
export const TOURS: Tour[] = [
  {
    id: "clean", title: "A clean report, posted with no human step",
    point: "When both signals agree on every key figure, the system posts on its own and says why.",
    steps: [
      { minutes: 0.5, text: "The inbox: 18 synthetic GP reports (PDF, scans, Excel).", link: { kind: "page", path: "/", label: "Documents" } },
      { minutes: 1.5, text: "One run, step by step: classification, extraction, checks passed, the second read agrees, route auto-post.", link: { kind: "run", run: "cleanAutoPost" } },
      { minutes: 1, text: "The record in the portfolio system, cleared by policy, with its provenance.", link: { kind: "page", path: "/portfolio", label: "Portfolio system (mock)" } },
    ],
  },
  {
    id: "trap", title: "An inconsistent report goes to an analyst",
    point: "The GP's own TVPI does not add up. The reads agree, but the check fails, so a person decides.",
    steps: [
      { minutes: 1.5, text: "TVPI ≠ (distributions + NAV) / paid-in: the check fails, the critic re-reads the page and the print stays 1.38x, so the route is review.", link: { kind: "run", run: "trap1Approved" } },
      { minutes: 1, text: "The analyst's decision log: the figure accepted as printed, approved with a written reason.", link: { kind: "run", run: "trap1Approved", label: "Decision log" } },
      { minutes: 0.5, text: "Unknown GPs wait in triage; nothing is guessed.", link: { kind: "page", path: "/review", label: "Review queue" } },
      { minutes: 0.5, text: "Posted, with the analyst and the reason in the record.", link: { kind: "page", path: "/portfolio", label: "Portfolio system (mock)" } },
    ],
  },
  {
    id: "loop", title: "The improvement loop, as it happened on 11 October",
    point: "A cheaper model passed every dev metric; the held-out set caught an unsafe post; the loop fixed it.",
    steps: [
      { minutes: 1, text: "The eval gate: zero unsafe auto-posts, accuracy never below the baseline, on every push.", link: { kind: "page", path: "/evals", label: "Evals" } },
      { minutes: 1, text: "What went wrong and why, step by step.", link: { kind: "doc", file: "docs/error-analysis/2026-10-11-sonnet-restatement.md", label: "Error analysis: the Sonnet switch" } },
      { minutes: 0.5, text: "The unsafe post: the unrevised NAV, consistent with every ratio, so no check could catch it.", link: { kind: "run", run: "restatementWrongV1" } },
      { minutes: 0.5, text: "After the rollback and the policy fix: the footnote sends it to review; version 2 supersedes.", link: { kind: "run", run: "restatementCorrectedV2" } },
      { minutes: 0.5, text: "Both versions in the portfolio history; nothing was edited or deleted.", link: { kind: "page", path: "/portfolio", label: "Portfolio system (mock)" } },
    ],
  },
];

export type LoopEvent = { phase: string; time: string; text: string; evidence: Evidence[] };

// The improvement loop as it ran on 11 October 2026 (times CEST, from the development history).
export const LOOP_TIMELINE: LoopEvent[] = [
  { phase: "Shadow", time: "15:55",
    text: "Sonnet 5.5 replayed each LLM step on the 12 dev documents: no gated metric worse, about half the cost.",
    evidence: [{ kind: "doc", file: "evals/shadow/2026-10-11-summary.md", label: "Shadow summary" }] },
  { phase: "Switch", time: "16:13",
    text: "Approved by the product owner: classify, extract and read B on Sonnet 5.5, critic kept on Opus 5.5. The CI gate passed.",
    evidence: [{ kind: "doc", file: "evals/reports/2026-10-11-pipeline-0.12.0.md", label: "Dev eval, pipeline@0.12.0" }] },
  { phase: "Held-out", time: "16:17",
    text: "Measured once on the live site: one unsafe auto-post. The restatement was posted with the unrevised NAV, which is consistent with every ratio.",
    evidence: [{ kind: "run", run: "restatementWrongV1" }, { kind: "doc", file: "docs/error-analysis/2026-10-11-sonnet-restatement.md", label: "Error analysis" }] },
  { phase: "Rollback", time: "16:20",
    text: "Every step back on Opus 5.5, the last configuration measured safe on held-out. The restatement goes to review again.",
    evidence: [{ kind: "doc", file: "evals/reports/2026-10-11-pipeline-0.12.1.md", label: "Dev eval, pipeline@0.12.1" }] },
  { phase: "Cheapest fix", time: "16:28",
    text: "A rule, not a prompt or a model: a footnote marker seen by either read keeps the figure from auto-posting (policy@3).",
    evidence: [{ kind: "doc", file: "SPEC-confidence.md", heading: "Decisions (approved 2026-10-11)" }, { kind: "test", file: "tests/core/confidence/assess.test.ts" }] },
  { phase: "Re-measure", time: "16:34",
    text: "Sonnet re-measured on held-out without switching production: still unsafe. Its first read took the table NAV 3 times out of 3.",
    evidence: [{ kind: "doc", file: "evals/candidates/2026-10-11-heldout-classify+extract+confidence-claude-sonnet-5-5.md", label: "Candidate on held-out" }] },
  { phase: "Decision", time: "16:34",
    text: "Production stays on Opus 5.5. A cheaper model held every average and still failed the one rare, costly case.",
    evidence: [{ kind: "doc", file: "docs/error-analysis/2026-10-11-sonnet-restatement.md", heading: "Follow-up (decisions 1-3, same day)" }] },
  { phase: "Repair", time: "16:36",
    text: "The wrong record was superseded through review (version 2). Held-out on production: 6 of 6 routes, 0 unsafe.",
    evidence: [{ kind: "run", run: "restatementCorrectedV2" }, { kind: "doc", file: "docs/acceptance/2026-10-11-evals.md", label: "Evals acceptance" }] },
];

// What each held-out measurement measured, for the history table.
export const HELDOUT_NOTES: Record<string, string> = {
  "pipeline@0.7.0": "All steps on Opus 5.5, policy@1. 5 documents: workbooks were supported from 0.8.0. The restatement failed on a database timeout (no model call); the unchanged re-run went to review with 0 differences.",
  "pipeline@0.12.0": "Classify, extract and read B on Sonnet 5.5. The restatement was auto-posted with a wrong NAV.",
  "pipeline@0.13.0": "All steps on Opus 5.5, policy@3: the production configuration.",
};

export type Requirement = { need: string; choice: string; evidence: Evidence[] };

// Business requirement → technical choice.
export const REQUIREMENTS: Requirement[] = [
  {
    need: "Never post a wrong figure without a human seeing it.",
    choice: "Two independent signals per key figure (checks + a second read of the image); zero unsafe auto-posts is a hard CI gate.",
    evidence: [
      { kind: "doc", file: "docs/adr/0005-two-signal-confidence-policy.md" },
      { kind: "test", file: "tests/core/confidence/assess.test.ts" },
    ],
  },
  {
    need: "Every posted figure can be audited.",
    choice: "Append-only records and decisions, a versioned policy and pipeline, provenance on every record.",
    evidence: [
      { kind: "doc", file: "SPEC-posting.md", heading: "What gets posted (the record)" },
      { kind: "test", file: "supabase/tests/posting.sql" },
    ],
  },
  {
    need: "Analysts' time goes where the system is unsure.",
    choice: "Only flagged figures are reviewed, each next to its page and with the reason; clean reports post on their own.",
    evidence: [
      { kind: "doc", file: "SPEC-review.md", heading: "User flows" },
      { kind: "run", run: "trap1Approved" },
    ],
  },
  {
    need: "A report never lands on the wrong fund.",
    choice: "Classification against the fund registry; an unknown GP is not guessed but sent to triage.",
    evidence: [
      { kind: "doc", file: "SPEC-pipeline.md", heading: "Step details" },
      { kind: "run", run: "triageUnknownGp" },
    ],
  },
  {
    need: "Scanned and Excel reports work too.",
    choice: "OCR for scans with the page image as the independent read; a label-anchored cell lookup for workbooks.",
    evidence: [
      { kind: "doc", file: "docs/adr/0004-page-rendering-and-ocr.md" },
      { kind: "run", run: "scanApproved" },
      { kind: "run", run: "xlsxAutoPost" },
    ],
  },
  {
    need: "Costs stay predictable.",
    choice: "A daily LLM budget enforced before each call; cheaper models adopted per step only on measured evidence.",
    evidence: [
      { kind: "doc", file: "SPEC-platform.md", heading: "Security & guardrails" },
      { kind: "doc", file: "evals/shadow/2026-10-11-summary.md" },
    ],
  },
  {
    need: "A change can never silently make things worse.",
    choice: "The golden set runs in CI on every push; a deliberately broken change was shown to fail it.",
    evidence: [
      { kind: "doc", file: "SPEC-evals.md", heading: "Runner and gate" },
      { kind: "doc", file: "docs/evals/gate-proof.md" },
    ],
  },
  {
    need: "Fund data stays confidential.",
    choice: "The browser never talks to the database; deny-all row security; secrets only in server functions; synthetic data only.",
    evidence: [
      { kind: "doc", file: "docs/adr/0003-server-only-data-access.md" },
      { kind: "test", file: "supabase/tests/platform.sql" },
      { kind: "doc", file: "docs/security/2026-10-11-audit.md", label: "Security audit" },
    ],
  },
];

// What the app renders: the repository's own documents and tests (SPEC-showcase), nothing else.
const ARTIFACTS = [
  /^CAPABILITY-MAP\.md$/, /^SPEC-[a-z-]+\.md$/, /^tasks\/[\w-]+\.md$/, /^docs\/[\w/.-]+\.md$/,
  /^evals\/(reports|shadow|candidates)\/[\w.+-]+\.md$/, /^tests\/[\w/.-]+\.test\.ts$/, /^supabase\/tests\/[\w-]+\.sql$/,
  /^e2e\/[\w-]+\.spec\.ts$/,
];

// The same set as globs, for the Vite loader (src/showcase/artifacts.ts); a test keeps the two and the repository in sync.
export const ARTIFACT_GLOBS = [
  "CAPABILITY-MAP.md", "SPEC-*.md", "tasks/*.md", "docs/**/*.md", "evals/reports/*.md", "evals/shadow/*.md",
  "evals/candidates/*.md", "tests/**/*.test.ts", "supabase/tests/*.sql", "e2e/*.spec.ts",
] as const;

export const isArtifact = (file: string) => !file.split("/").includes("..") && ARTIFACTS.some((r) => r.test(file));

export const slug = (heading: string) =>
  heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-");

export function hrefFor(e: Evidence): string {
  switch (e.kind) {
    case "run": return `/runs/${DEMO_RUNS[e.run].id}`;
    case "page": return e.path;
    case "test": return `/docs/${e.file}`;
    case "doc": return `/docs/${e.file}${e.heading ? `#${slug(e.heading)}` : ""}`;
  }
}

export function labelFor(e: Evidence): string {
  if (e.label) return e.label;
  switch (e.kind) {
    case "run": return DEMO_RUNS[e.run].label;
    case "test": return e.file.split("/").at(-1) ?? e.file;
    case "doc": return e.heading ? `${e.file} › ${e.heading}` : e.file;
    case "page": return e.label;
  }
}

export type ProcessStep = { name: string; gate: boolean; text: string; example: Evidence };

// The agent-skills flow, as followed for every module (gate: a human decision before the next step).
export const PROCESS_STEPS: ProcessStep[] = [
  { name: "Capability map", gate: true, text: "The case split into modules with a dependency order; approved before any spec.",
    example: { kind: "doc", file: "CAPABILITY-MAP.md", label: "Capability map" } },
  { name: "Spec", gate: true, text: "Per module: objective, boundaries (always / ask first / never), success criteria, open questions for the product owner.",
    example: { kind: "doc", file: "SPEC-evals.md", label: "SPEC-evals" } },
  { name: "Plan and tasks", gate: true, text: "Small vertical slices, each with acceptance criteria and how it is verified; approved before building.",
    example: { kind: "doc", file: "tasks/plan-evals.md", label: "Evals plan" } },
  { name: "Build, test first", gate: false, text: "One task at a time: a failing test, the code that passes it, the full suite, the build, one commit.",
    example: { kind: "test", file: "tests/core/evals/evals.test.ts" } },
  { name: "Review", gate: true, text: "Checkpoints per module: code review, security review, and a decision on anything the spec did not cover.",
    example: { kind: "doc", file: "docs/adr/0005-two-signal-confidence-policy.md", label: "ADR-0005" } },
  { name: "Ship and accept", gate: false, text: "CI and the eval gate on every push, deploy, then every success criterion checked on the live site with evidence.",
    example: { kind: "doc", file: "docs/acceptance/2026-10-11-evals.md", label: "Evals acceptance" } },
];

export type ArtifactGroup = { title: string; files: string[] };

const GROUPS: { title: string; test: (f: string) => boolean }[] = [
  { title: "Capability map and specs", test: (f) => f === "CAPABILITY-MAP.md" || f.startsWith("SPEC-") },
  { title: "Plans and task lists", test: (f) => f.startsWith("tasks/") },
  { title: "Architecture decisions", test: (f) => f.startsWith("docs/adr/") },
  { title: "Error analyses", test: (f) => f.startsWith("docs/error-analysis/") },
  { title: "Security", test: (f) => f.startsWith("docs/security/") },
  { title: "Acceptance reports", test: (f) => f.startsWith("docs/acceptance/") || f === "docs/pipeline-acceptance.md" },
  { title: "Eval reports and experiments", test: (f) => f.startsWith("evals/") || f.startsWith("docs/evals/") },
  { title: "Tests", test: (f) => f.startsWith("tests/") || f.startsWith("supabase/tests/") || f.startsWith("e2e/") },
];

// The process page's index: every rendered document in exactly one group (the capability map first, then by name).
export function artifactGroups(files: string[]): ArtifactGroup[] {
  const order = (a: string, b: string) => (a === "CAPABILITY-MAP.md" ? -1 : b === "CAPABILITY-MAP.md" ? 1 : a.localeCompare(b));
  return GROUPS.map((g) => ({ title: g.title, files: files.filter((f) => GROUPS.find((x) => x.test(f)) === g).sort(order) }));
}

export const docTitle = (file: string, text: string) => text.match(/^# (.+)$/m)?.[1]?.trim() ?? file.split("/").at(-1) ?? file;
