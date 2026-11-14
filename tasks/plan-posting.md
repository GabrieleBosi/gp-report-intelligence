# Implementation Plan: posting

Scope: [SPEC-posting.md](../SPEC-posting.md) (approved 2026-10-11). Tasks: the "Posting" section of [todo.md](todo.md).

## Overview
Same shape as review: rules first (pure), then storage, then wiring, then screens, then proof. S1 builds the record and
the posting rules without I/O. S2 adds the mock portfolio system and the posting log, with versioning done atomically
in the database. S3 wires the two automatic paths (end of pipeline, on approval) and the retry endpoint. S4 shows it.
S5 proves the six success criteria end to end.

## Architecture Decisions
- **One core function posts** (`postRun`), called by the pipeline, the review API and the retry endpoint, so the three
  paths cannot drift apart.
- **The portfolio system is a port.** The Supabase mock implements it; tests use a fake that can fail on demand.
- **Versioning is atomic in the database** (one SQL function: idempotency by run id, "unchanged" detection, supersede),
  so two concurrent posts for one fund and period cannot both become the current version.
- **Logging is around the call:** an attempt row is written for every outcome, including failures, before the run
  status changes.

## Dependency graph
```
S1 record + rules (pure) ─► S2 mock system + log ─► S3 auto-post, on approval, retry ─► S4 Run page + portfolio page ─► S5 e2e + acceptance
```

## Tasks (sizes: S < 2 h, M < 4 h)
| Task | Size | Proves |
|---|---|---|
| S1 Record and posting rules (pure core) | M | record from the latest round with provenance; eligibility; idempotency; unchanged; 422 not retried; outage logged |
| S2 Mock portfolio system and posting log | M | append-only records with versions; atomic post function; SQL contract |
| S3 Wiring: auto-post, on approval, retry | M | clean run ends posted; approval posts; `POST /api/runs/:id/post` |
| S4 Posting on the Run page and the portfolio page | S | posted record, attempts, Retry; current records with history |
| S5 E2E and live acceptance | S | criteria 1-6 with evidence |

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| The pipeline's background function fails after step 7 because posting fails | High | posting failures are caught and logged; the run keeps `ready_to_post` (retry), never `failed` |
| Concurrent posts of one fund and period | Low | one SQL function with a row lock on the record |
| Demo re-runs fill the history with identical versions | Low | "unchanged" skip (decision 4) |
