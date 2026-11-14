# Spec: showcase

Module id: `showcase` · Depends on: all modules · Status: **approved** 2026-10-11

## Objective
Inside the app, explain **how this system was built and why it can be trusted**, to a reviewer and to anyone who opens the site later. A reader should leave with three
convictions, each backed by evidence they can click:
1. **The business problem was understood:** my process sketch (steps 1-9 and the improvement loop) is the system's
   architecture, and every business requirement maps to a technical choice.
2. **The process is disciplined:** spec → plan → tasks → test-first build → review → ship (agent-skills), with human
   decisions at the gates, recorded.
3. **The system is measured, not assumed:** golden set, eval gate in CI, shadow runs, held-out measurement; including
   today's worked example, where held-out caught an unsafe model switch before it could do lasting harm.

Non-goal: marketing. Every claim on these pages links to an artifact (spec section, test, report, commit, live run).

## Pages (all behind the site password, linked from the header)
1. **Overview (`/about`)**: the case in three sentences; the **sketch, rebuilt as an interactive diagram**: each step
   (1 receive … 9 review, plus the improvement loop) opens a panel with what it does, who acts (system / AI / analyst),
   the business requirement it serves, the technical choice, its spec section, its tests, and a link to a live run that
   shows it.
2. **Demo tour (`/tour`)**: three guided scenarios, each a short sequence of links into the live app, built for a 10
   minute walkthrough: (a) a clean report auto-posted end to end; (b) trap 1, the inconsistent report: two signals →
   review → analyst approval → posted with the reason; (c) the improvement loop: shadow → switch → held-out caught an
   unsafe post → rollback → policy fix → re-measure → record superseded.
3. **How it was built (`/process`)**: the agent-skills flow with the real artifacts rendered in-app: capability map,
   the seven specs, plans, task lists (with their checkmarks), ADRs, error analyses, acceptance reports; plus build
   facts (commits, tests, CI runs, spend), generated from the repository.
4. **Decisions (`/decisions`)**: every product-owner decision (date, question, options, choice, evidence), extracted from
   the specs' "Decisions" sections, and a **requirement → technical choice** table (e.g. "never post a wrong figure" →
   two independent signals + the unsafe-auto-post gate; "auditability" → append-only records + versioned policy).
5. **Evals (`/evals`)**: the latest eval report (metrics, errors by first bad step), baseline, held-out results, the
   shadow summary, the gate proof; and **live operating numbers** from the database: documents, runs by route,
   review decisions, postings, LLM spend.

## Data sources
- **Repository artifacts at build time:** specs, plans, ADRs, reports and eval JSON are imported into the bundle
  (Vite raw imports), so a reader never needs GitHub access (the repository was private while it was built). Decisions are parsed from the
  specs, so the page cannot drift from them.
- **Build facts:** `npm run showcase:facts` writes `src/generated/build-facts.json` (commits, tests, CI runs, spend by
  module) from git and the test runner; regenerated and committed at the freeze.
- **Live numbers:** `GET /api/metrics`: read-only aggregates (no document content), server-side as always.

## Project Structure (additions)
```
src/pages/about.tsx, tour.tsx, process.tsx, decisions.tsx, evals.tsx
src/components/sketch-diagram.tsx, doc-viewer.tsx
src/showcase/content.ts      → the sketch steps, requirement → choice mapping, tour scripts (data, not prose in JSX)
src/showcase/decisions.ts    → parse "Decisions" sections from the specs (pure, tested)
src/generated/build-facts.json
scripts/showcase-facts.ts
netlify/functions/metrics.ts, core/showcase/metrics.ts
```

## Code Style
As in SPEC-platform; UI per the existing pages (Tailwind, accessible components). Content lives in data files, so the
wording can be reviewed like code.

## Testing Strategy
- **Unit:** the decisions parser on every spec (count and fields); the metrics aggregation; every link in
  `content.ts` points at an existing route, spec file or document.
- **E2E (Playwright, local):** each showcase page loads; the sketch diagram is keyboard-operable; each tour scenario's
  links resolve; a spec renders inside the app.
- **Visual check:** screenshots at 1280×720 (projector) and 390 px (phone).

## Boundaries
- **Always:** every claim links to evidence; dates on every measurement; numbers either live or from a dated report.
- **Ask first:** new dependencies (a Markdown renderer, see question 1); anything public; changing a measured number by
  hand.
- **Never:** any real organisation's branding or real fund data; overstating results (held-out is 6 documents, said plainly); secrets or
  document content in `/api/metrics`.

## Success Criteria
1. Each of the 9 sketch steps and the improvement loop opens a panel linking to its spec section, its tests and a live
   run that shows it.
2. The three tour scenarios can be walked in under 10 minutes, every link resolving.
3. All specs, plans, ADRs, error analyses and acceptance reports render inside the app.
4. The decisions page lists every decision recorded in the specs (count checked by a test) with date and evidence.
5. The evals page shows the latest eval and held-out numbers with their dates, and live operating numbers.
6. Usable on a 1280×720 projector and a phone, keyboard-accessible, readable contrast.

## Decisions (approved 2026-10-11)
1. **Markdown:** add `marked` (small, no dependencies) to render the repository's own artifacts, compiled at build time.
2. **Priority if time runs short:** overview + tour, then evals, decisions, the document viewer, live metrics last.
3. **Tone:** for a reader with business and technical interest: business point, technical choice, evidence; English; short paragraphs.
4. **Build facts:** regenerated once, on purpose, and committed.
