# Spec: review

Module id: `review` · Depends on: `confidence` · Status: **approved** 2026-10-11

## Objective
Sketch step 9, **Review UI: accept / fix / reject**, plus the triage queue for unknown GPs or layouts. Step 7 already
says *why* a document stopped (per key figure: read A, read B, checks, level, reason). Review lets an analyst act on that
evidence with the source page beside it, and keeps every decision as feedback for the improvement loop (evals).

Business goal, in priority order:
1. **Nothing reaches the portfolio system unreviewed or unexplained:** every approval records who decided, what changed
   and why, next to the policy and evidence that sent the document to review.
2. **Fast decisions:** the analyst sees only the figures that need attention first, with the source page one click away.
3. **Every correction becomes data:** a fixed figure is a labelled example of a pipeline error (step, field, before,
   after), which the evals module turns into regression cases.

**Users:** the analyst (desk work), a reviewer (watches a trap get fixed and approved), evals (reads the
corrections).

## Scope
**In:** a queue of documents waiting for a human; a review screen per run; field corrections with live re-checking;
approve, reject, and triage actions; an append-only decision log; the source page as an image.
**Out (other modules):** posting to the internal system (`posting`: picks up approved runs); turning corrections into eval
cases (`evals`); adding funds to the registry (ask first, see Boundaries).

## User flows
1. **Queue** (`/review`): latest run per document with status `needs_review` or `needs_triage`, oldest first, showing the
   fund (or "unknown GP"), period, route reason summary and age. Counts per status in the header.
2. **Review a run** (`/runs/:id`, review mode when the run is waiting):
   - Left: the source page as an image (page picker; jumps to the page a figure cites). Right: key figures first, sorted
     by confidence (low → medium → high), then the other fields.
   - Per figure: **accept as printed** or **correct** (enter the value as printed + the page). A correction goes through
     the same normalizer and identity checks (pure core), so the analyst sees the checks update before deciding.
3. **Decide the document:**
   - **Approve** → status `approved` (posting takes it from there). Allowed when every key figure is high or reviewed.
     If any check still fails (e.g. trap 1: the report itself is inconsistent), approval needs a **mandatory reason**
     ("posted as printed; GP notified").
   - **Reject** → status `rejected`, with a mandatory reason (e.g. "ask GP for a corrected report").
4. **Triage** (unknown GP or incomplete classification): **assign to a known fund** from the registry (the run moves to
   `needs_review` with that fund), or **reject**. Creating a new fund is out of scope.

## Data and status
- Run statuses gain `approved`. Allowed transitions: `needs_review` → `approved` | `rejected`;
  `needs_triage` → `needs_review` (fund assigned) | `rejected`. Enforced in code and by a database check on transitions.
- `review_decisions` (append-only): run_id, kind (`field_accepted` | `field_corrected` | `approved` | `rejected` |
  `fund_assigned`), field path, value before / after (raw + normalized + page), reason, analyst, policy version of the
  assessment reviewed, created_at.
- The corrected extraction is stored as a new `extractions` round (`source: analyst`), never by editing an earlier one.
- Every decision also writes an `audit_events` row (step 9, actor `analyst:<name>`).

## API (server-only data access, as today)
- `GET /api/review/queue` → waiting runs.
- `GET /api/runs/:id/pages/:n` → PNG of the source page (rendered on demand at 130 dpi, cached in `page-images`).
- `POST /api/runs/:id/review` with one action: `correct` | `accept_field` | `approve` | `reject` | `assign_fund`. Validated
  with zod; returns the updated run view (checks recomputed).

## Project Structure (additions)
```
core/review/actions.ts     → pure: apply a correction (normalize + checks), allowed transitions, approval rules
core/review/queue.ts       → pure: queue ordering and summaries
netlify/functions/review.ts, page-image.ts
netlify/lib/review-store.ts → review_decisions, status transitions, analyst extraction rounds
src/pages/review-queue.tsx, src/components/review-panel.tsx, src/components/source-page.tsx
supabase/migrations/*_review.sql
```

## Code Style
As in SPEC-platform. Approval rules and transitions are a small table in `core/review/actions.ts`, one test per row.

## Testing Strategy
- **Unit (core):** corrections re-run normalization and checks; transition table (every allowed and forbidden move);
  approval requires a reason exactly when a check still fails; triage assignment.
- **SQL contract:** `review_decisions` append-only, status transitions enforced, anon has no access.
- **Function:** each action with fakes, including forbidden transitions (409) and missing reasons (400).
- **E2E (Playwright, local):** trap 1 in the queue → open → page image shows → approve with reason → status `approved`.

## Boundaries
- **Always:** a reason for every rejection and for every approval with a failed check; corrections keep raw value and
  page; decisions append-only; the analyst name recorded with each decision.
- **Ask first:** adding funds to the registry from triage; letting an approval bypass a failed check without a reason;
  bulk approval.
- **Never:** edit a stored extraction or decision in place; let review change an assessment's recorded policy outcome
  (the assessment stays as evidence; the decision is a separate record).

## Success Criteria
1. The queue lists every waiting run (trap 1, chart NAV, restatement, scans, uploads, Tessera) with its reason.
2. Trap 1: the analyst sees "report itself may be inconsistent", opens page 1, approves with a reason; the run becomes
   `approved` and the decision log shows who, when, why.
3. A correction (e.g. a scan's OCR-damaged EBITDA 724 → 72.4, page 3) clears the failed check on screen before approval
   and is stored as a decision with before/after and as a new extraction round.
4. Tessera: assigning it to a known fund is possible only for funds in the registry; rejecting needs a reason.
5. Forbidden transitions (approve a `ready_to_post` run, approve twice, reject without a reason) are refused by the API
   and the database.
6. The page image loads in < 3 s cold and is served only through the function.

## Decisions (approved 2026-10-11)
1. **Analyst identity:** the analyst types a name once (kept in the browser); it is recorded with each decision and
   labelled as self-declared. Production would use real authentication (Supabase Auth); the site has one shared password.
2. **Approving with a failed check:** allowed only with a mandatory reason (trap 1: the GP's report is inconsistent; the
   analyst may post it as printed while asking the GP).
3. **Triage:** assign to an existing registry fund or reject; no new funds from the UI.
4. **Auto-posted runs:** no spot-check view now; the evals module measures auto-post precision.
