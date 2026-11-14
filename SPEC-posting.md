# Spec: posting

Module id: `posting` · Depends on: `confidence`, `review` · Status: **approved** 2026-10-11

## Objective
Sketch step 8, **"Post via API + log"**: put a document's figures into the internal portfolio system once step 7 or an
analyst has cleared them, and keep an auditable record of every attempt. The internal system is a **mock** with the
behaviour of a real one (idempotency, validation, versioned records, possible outages), behind a port, so a real
system could replace it without touching the pipeline.

Business goal, in priority order:
1. **Only cleared documents are posted:** a run whose route was `auto_post` (status `ready_to_post`) or that an analyst
   approved (status `approved`). Nothing else, enforced in code and in the database.
2. **Exactly once:** a retry never creates a second record; a newer report for the same fund and quarter replaces the
   current record as a new version, and the old version stays in the history.
3. **Every attempt is explained:** what was sent, what came back, and on whose authority (policy for auto-posts,
   analyst and reason for approvals).

**Users:** the operations team (sees what reached the portfolio system and when), the analyst (an approval posts the
document), a reviewer (clean report → posted with no human; trap 1 → approved → posted), evals (posted
figures vs labels).

## What gets posted (the record)
- **Identity:** fund (registry id), GP, period end, currency, report type.
- **Figures:** all fund figures and every portfolio company (values in full units, with page sources), from the latest
  extraction round, so an analyst's corrections are what gets posted.
- **Provenance:** run id, document sha256, pipeline version, policy version, how it was cleared (`auto_post` or
  `approved` by <analyst> with the reason), and the analyst corrections included.

## Flows
1. **Auto-post:** when a run ends `ready_to_post`, the pipeline posts it right away (same background function, after
   step 7). Success → run status `posted`.
2. **Post on approval:** when an analyst approves, the review API posts it right away. Success → `posted`.
3. **Outage:** if the portfolio system fails (timeout, 5xx), the run keeps its status (`ready_to_post` or `approved`),
   the failed attempt is logged with the error, and the Run page offers **Retry posting**.
4. **Restatement:** a later cleared run for the same fund and period is posted as **version n+1** of that record;
   version n is marked superseded (kept, never edited).

## The mock portfolio system
- A port `PortfolioSystem.post(record, idempotencyKey) → { recordId, version, supersedes? }` with an in-process
  Supabase implementation (`portfolio_records`, append-only). Idempotency key = run id: posting the same run again
  returns the original result.
- It validates like a real system would: a known fund id, a period end, currency, and the six fund key figures present
  (otherwise 422, which is logged and shown, and never retried automatically).
- Fault injection for tests (a fake that fails N times); no outage switch on the live site.
- A read-only **Portfolio system (mock)** page lists the current records (fund, period, NAV, TVPI, DPI, version, posted
  at, cleared by), with the history per record.

## Data and status
- Run statuses: `ready_to_post` → `posted`, `approved` → `posted` (the transition trigger already allows exactly these).
- `postings` (append-only): run_id, attempt, outcome (`posted` | `failed` | `rejected`), record id and version,
  error, request hash, created_at. Every attempt also writes an `audit_events` row (step 8).
- `portfolio_records` (append-only, the mock system's store): record id (fund + period), version, payload,
  superseded_by, posted_at.

## API
- `POST /api/runs/:id/post`: retry posting a cleared run (the automatic paths call the same core function).
- `GET /api/portfolio` → current records with their history (for the mock-system page).

## Project Structure (additions)
```
core/posting/record.ts      → pure: build the record from a run (latest round, provenance), validate it
core/posting/post.ts        → pure orchestration: eligibility, idempotency, attempt logging, status change
netlify/lib/portfolio-system.ts → the mock system (Supabase), behind the PortfolioSystem port
netlify/functions/post.ts, portfolio.ts
src/pages/portfolio.tsx, posting section on the Run page
supabase/migrations/*_posting.sql
```

## Code Style
As in SPEC-platform. Eligibility is one small table in `core/posting/post.ts`, tested row by row.

## Testing Strategy
- **Unit (core):** the record built from a run (latest analyst round wins, provenance complete); eligibility (only
  `ready_to_post` / `approved`); idempotent retry; a 422 is not retried; an outage leaves the status and logs the attempt.
- **SQL contract:** `postings` and `portfolio_records` append-only; the transition trigger still refuses posting
  from any other status; anon has no access.
- **Replay / e2e:** a clean dev document runs end to end and ends `posted` with a record visible on the portfolio page;
  trap 1 approved in the UI ends `posted` with the approval reason in the record's provenance.

## Boundaries
- **Always:** post only the latest extraction round; log every attempt before and after; idempotency key = run id.
- **Ask first:** posting anything that is not `ready_to_post` or `approved`; automatic retries; changing the record
  format (a real downstream system would depend on it).
- **Never:** edit or delete a posted record or a posting attempt; post an upload without an analyst's approval
  (policy@2); post from the browser (all posting is server-side).

## Success Criteria
1. A clean dev report runs end to end and ends `posted` with no human step; its record appears on the portfolio page.
2. Trap 1, approved in the review UI, ends `posted`; the record's provenance shows the analyst and the reason.
3. Posting the same run twice (retry) returns the same record and version; no second record.
4. Running the same report again and clearing it creates version 2; version 1 is marked superseded and still visible.
5. With the portfolio system failing, the run stays `ready_to_post` / `approved`, the failed attempt is logged, and
   Retry posting succeeds once the system is back.
6. No run in any other status can be posted (API 409, database trigger).

## Decisions (approved 2026-10-11)
1. **Mock system:** an in-process port with a Supabase-backed mock (the password gate stops a function from calling the
   site over HTTP). A real system replaces the adapter, not the pipeline.
2. **When to post:** immediately, at the end of the pipeline for `ready_to_post` runs and when an analyst approves.
3. **Same fund and period twice:** a new version supersedes the current one; history kept.
4. **Identical re-posts:** when the figures equal the current version, the posting is skipped and logged as
   `unchanged` (demo re-runs do not create identical versions).
