# Implementation Plan: review

Scope: [SPEC-review.md](../SPEC-review.md) (approved 2026-10-11). Tasks: the "Review" section of [todo.md](todo.md).

## Overview
Rules first, then data, then the screen. V1 builds every review rule as pure code (transitions, approval reasons,
corrections re-checked by the same normalizer). V2 adds the tables and the database guards. V3 serves the source page
image through a function. V4 is the review API. V5 is the queue and the review screen. V6 proves it end to end on trap 1
and checks every success criterion live.

## Architecture Decisions
- **Rules are a table in pure code** (`core/review/actions.ts`), mirrored by a database transition check, so neither a UI
  bug nor a direct API call can approve twice or skip a reason.
- **A correction is a new extraction round** (`source: analyst`, round 3+), recomputed by `normalizeRaw`: the analyst
  sees exactly the checks the pipeline would run, and nothing stored is edited.
- **The assessment stays as evidence.** Review decisions are separate append-only rows; the step-7 record of why the
  document was stopped never changes.
- **Page images go through a function** (rendered on demand at 130 dpi, cached in the private `page-images` bucket):
  the browser still never talks to Supabase.

## Dependency graph
```
V1 rules (pure) ─► V2 tables + store ─► V4 review API ─► V5 queue + review UI ─► V6 e2e + acceptance
                    V3 page image ──────────────────────┘
```

## Tasks (sizes: S < 2 h, M < 4 h)
| Task | Size | Proves |
|---|---|---|
| V1 Review rules (pure core) | M | transitions, approval reasons, correction re-check, triage assignment |
| V2 Migration + review store | M | append-only decisions, `approved` status, transition check in SQL, analyst rounds |
| V3 Source page image | S | `GET /api/runs/:id/pages/:n`, cached, < 3 s cold |
| V4 Review API | M | each action, 400 / 409 refusals, updated run view |
| V5 Queue + review screen | M | the analyst flow, accessible, analyst name |
| V6 E2E + live acceptance | S | trap 1 approved with a reason; criteria 1-6 with evidence |

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| The extractions table allows rounds 0-2 only | Med | V2 migration widens it and adds `source`; SQL test covers both |
| Concurrent decisions on one run (two tabs) | Low | transitions checked in one SQL statement on the current status; the loser gets 409 |
| The page image is slow on a cold start | Low | cached per page in `page-images`; measured in V3 |
| The review UI grows large | Med | review panel reuses the confidence table and extraction panel components |
