# ADR-0002: Pipeline runs in Netlify background functions

Status: Accepted · 2026-10-10

## Context
One pipeline run makes several LLM calls (classify, extract per section, the vision second read, up to 2 critic rounds).
Expected duration is 30–120 s on scans, beyond the timeout of synchronous functions.

## Options
1. **Synchronous function**: simplest, but times out on real documents.
2. **Background function + status polling**: returns 202 immediately and runs for up to 15 min. The UI polls `pipeline_runs.status`.
3. **External queue/worker** (e.g. a managed queue + container): the production-grade answer, but a second platform to operate for a demo.

## Decision
Option 2. Every step writes its progress to `pipeline_runs`/`audit_events`, so the UI can poll the same table that serves as the audit trail.
`ping-background` proved invocation on the deployed site (function logs, 2026-10-10).

## Consequences
- No result is returned to the caller; state lives in Postgres, which the audit log needs anyway.
- No built-in retries: a failed run is marked `failed` with its error and can be re-queued from the UI.
- At enterprise scale this becomes option 3; the `core/` pipeline is unchanged (ADR-0001).
