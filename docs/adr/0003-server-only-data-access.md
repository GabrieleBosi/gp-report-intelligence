# ADR-0003: Server-only data access, deny-all RLS, Zurich region

Status: Accepted · 2026-10-10

## Context
The site has no user accounts: it sits behind a Netlify site-wide password. Fund report data is confidential in the
real setting, and the audit trail must be tamper-evident.

## Decision
- The browser never talks to Supabase. Only Netlify Functions do, with the service-role key (Functions-scoped env var).
  A lint rule blocks `@supabase/*` and `netlify/**` imports from `src/`.
- Every table has RLS **enabled with no policies**, and `anon`/`authenticated` grants are revoked. The Supabase
  advisor's `rls_enabled_no_policy` (INFO) finding is therefore intentional.
- `audit_events` is append-only: triggers block UPDATE, DELETE and TRUNCATE for every role, including service_role.
- Project region `eu-central-2` (Zurich) for data residency. Raw files go to the private bucket `raw-reports`
  (10 MB cap, PDF/XLSX MIME allow-list).
- The schema contract is tested by `supabase/tests/platform.sql` (rolled back, leaves no rows).

## Consequences
- One trust boundary to reason about (the functions), instead of auth plus per-row policies.
- Adding real users later means adding Supabase Auth and policies. The deny-all default is the safe starting point.
- Corrections to audited data are new events, never edits.
