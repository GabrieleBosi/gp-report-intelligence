# Implementation Plan: showcase

Scope: [SPEC-showcase.md](../SPEC-showcase.md) (approved 2026-10-11). Tasks: the "Showcase" section of [todo.md](todo.md).

## Overview
Content first, then pages in the approved priority order. H1 puts every word and link into reviewed, tested data
(sketch steps, requirement → choice, tour scripts) and parses the decisions out of the specs. H2-H5 are the pages in
priority order (overview, tour, evals, decisions). H6 adds the in-app document viewer and the build facts. H7 adds the
live operating numbers. H8 proves it end to end and on a projector-sized screen.

## Architecture Decisions
- **Content is data** (`src/showcase/content.ts`): the wording is reviewed like code, and a test checks that every
  link points at a real route, spec heading, document or run.
- **Artifacts compiled in:** specs, ADRs, reports and eval JSON are Vite raw imports, so the pages work without GitHub
  and cannot show a stale copy of a document.
- **Decisions parsed, not retyped:** the decision log comes from the specs' "Decisions" sections; a test counts them.
- **Live numbers through one read-only function** with aggregates only (no document content).
- **Links into the live app use stable demo runs:** the tour and the sketch panels point at specific run ids recorded
  in `content.ts` (chosen once, kept as the demo set), so a link never lands on an empty page.

## Dependency graph
```
H1 content + decisions parser ─► H2 overview ─► H3 tour ─► H4 evals ─► H5 decisions ─► H6 docs + facts ─► H7 live metrics ─► H8 e2e + acceptance
```

## Tasks (sizes: S < 2 h, M < 4 h)
| Task | Size | Proves |
|---|---|---|
| H1 Content, demo runs and the decisions parser | M | every link resolves; every spec decision parsed |
| H2 Overview with the interactive sketch | M | 9 steps + improvement loop, keyboard-operable, each with evidence |
| H3 Demo tour | S | 3 scenarios, < 10 minutes |
| H4 Evals page | M | latest eval, held-out, shadow, gate proof, the improvement-loop timeline |
| H5 Decisions page | S | every decision with date and evidence; requirement → choice table |
| H6 Document viewer and build facts | M | every artifact rendered in-app (`marked`); facts generated from the repo |
| H7 Live operating numbers | S | `GET /api/metrics`, aggregates only |
| H8 E2E, visual checks, acceptance | S | criteria 1-6 with evidence; 1280×720 and 390 px |

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Showcase pages read as marketing | High | every claim links to evidence; numbers dated; held-out size stated plainly |
| A demo link lands on a run that changed status | Med | stable demo run set in `content.ts`, checked by the e2e test |
| The bundle grows with all documents | Low | documents are lazy-loaded per page |
