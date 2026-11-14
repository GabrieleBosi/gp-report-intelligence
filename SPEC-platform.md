# Spec: platform

Module id: `platform` · Depends on: — · Status: **approved** 2026-10-10

## Objective
Provide the foundation that every other module ships on: a private repo with CI,
a password-protected Netlify site, and a Supabase project for raw files,
pipeline state and the audit trail. Everything should be secure and observable
from day one, because a reviewer judges "enterprise-grade" partly on
what they can see here: robustness, observability, security.

**User:** a reviewer (opens the site with a shared password) and Gabriele
(develops and demos).

## Tech Stack
| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript 6.x, `strict: true` + `noUncheckedIndexedAccess` | One language for UI, functions, pipeline and tests |
| Frontend | Vite + React 19 + React Router, Tailwind CSS | Static SPA, no SSR needed behind a password |
| Server | Netlify Functions (sync for reads, **background functions** for pipeline runs, 15 min limit) | Pipeline runs take 30–120 s, beyond the sync function timeout |
| Data | Supabase Postgres + Storage (bucket `raw-reports`, private), region **eu-central-2 (Zurich)** if available, else eu-central-1 | Data residency is a compliance point worth showing |
| Validation | `zod` | One schema shared by LLM output parsing, DB writes and tests |
| LLM | `@anthropic-ai/sdk` | Decided at approval |
| Tests | Vitest (unit/integration), Playwright (1 smoke e2e) | |
| CI | GitHub Actions | |
| Runtime | Node 22 LTS on Netlify (local: Node 26) | Pin `NODE_VERSION=22` in `netlify.toml` |

New dependencies beyond this list → ask first.

## Commands
```
Install:    npm ci
Dev:        npx netlify dev            # Vite + functions on http://localhost:8888
Build:      npm run build              # tsc --noEmit && vite build
Typecheck:  npm run typecheck
Lint:       npm run lint               # eslint . --max-warnings 0
Test:       npm test                   # vitest run --coverage
E2E:        npm run test:e2e           # playwright test
DB:         npx supabase db push       # apply supabase/migrations to linked project
Deploy:     git push origin main       # Netlify builds main; PRs get deploy previews
```

## Project Structure
```
CAPABILITY-MAP.md, SPEC-*.md   → approved map + per-module specs (root, by design)
src/                           → React app (pages/, components/, lib/api.ts)
core/                          → framework-free domain logic: schema, pipeline steps, checks, confidence
                                  (pure TS, imported by functions and tests; no Netlify/React imports)
netlify/functions/             → thin HTTP/background adapters around core/
supabase/migrations/           → SQL migrations (numbered, forward-only)
corpus/                        → see SPEC-corpus.md
tests/                         → *.test.ts mirroring core/ and netlify/functions/
e2e/                           → Playwright
docs/adr/                      → architecture decision records (NNNN-title.md)
tasks/                         → plan.md, todo.md (per planning-and-task-breakdown)
.github/workflows/ci.yml
netlify.toml
```

## Data model (platform-owned tables only; later modules add their own migrations)
- `documents`: id, sha256 (unique, dedupe), filename, mime, size_bytes, storage_path, source (`corpus` | `upload`), created_at
- `pipeline_runs`: id, document_id, status (`queued` | `running` | `needs_review` | `posted` | `rejected` | `failed`), pipeline_version, started_at, finished_at, error
- `audit_events`: id, run_id, step (`1`…`9`), actor (`system` | `llm:<model>` | `analyst`), event, payload jsonb, created_at. **Append-only:** no UPDATE/DELETE grants; a trigger blocks mutation.
- `usage_ledger`: id, run_id, model, input_tokens, output_tokens, cost_usd, created_at (feeds the daily spend cap)

RLS is enabled on every table with no policies (deny by default). Only Netlify
Functions touch the DB, using the service-role key. The browser never holds a Supabase key.

## Security & guardrails
- **Visitor access:** Netlify Pro site-wide password protection, covering deploy previews too. Gabriele sets the password in the Netlify UI; it is never in the repo.
  *Superseded 2026-11-14 by [SPEC-public-release.md](SPEC-public-release.md) W2 and [ADR-0006](docs/adr/0006-public-snapshot-mode.md):*
  the site is public and reads a recorded snapshot; every function with a path checks the owner's access key instead.
- **Secrets:** `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` exist only as Netlify env vars (scoped to Functions) and in a git-ignored `.env` locally. `.env.example` lists the names.
- **Uploads:** PDF or XLSX only (magic bytes checked, not just extension), ≤ 4 MB, ≤ 20 pages, ≤ 30 uploads/hour site-wide, dedupe by sha256.
  *Changed from 10 MB on 2026-10-11 (T6), measured on the deployed site:* Netlify cuts a function's request body off at
  about 4.5 MB of file (6 MB after base64) with an empty 413, before our code runs. Larger files would need direct
  uploads to storage (signed URLs), which the "browser never talks to Supabase" boundary rules out today.
- **Spend cap:** a run is refused when `usage_ledger` for the current UTC day is ≥ `DAILY_LLM_BUDGET_USD` (default 15). The UI shows a clear message.
  *Default lowered to 5 on 2026-11-14 (SPEC-public-release); 0 stops all spending; a value that is not a number of dollars gets the default.*
- **Prompt-injection posture:** document text is always passed as data inside delimited tags, never as instructions. LLM output is accepted only through zod-validated tool/JSON schemas.
- Security headers in `netlify.toml` (CSP, `X-Frame-Options: DENY`, `Referrer-Policy`).

## Observability
- Every pipeline step writes an `audit_events` row (inputs hash, outputs, model, latency, tokens).
- `GET /api/health` returns `{ status, version: <Netlify deploy id>, anthropicKeyPresent, checks: { db, storage } }`, with HTTP 503 when degraded. It makes no paid LLM call and never echoes secrets or probe errors.
- Function logs are structured JSON (`{ level, runId, step, msg, ... }`).

## Code Style
```ts
// core/types.ts: domain types come from zod schemas, never duplicated by hand
import { z } from "zod";

export const Money = z.object({
  value: z.number().finite(),          // full units after normalization (1.2m -> 1_200_000)
  currency: z.string().length(3),      // ISO 4217
});
export type Money = z.infer<typeof Money>;

// netlify/functions/health.ts: adapters stay thin, logic lives in core/
export default async () => Response.json(await checkHealth(deps()));
```
- Named exports, no default exports in `core/`. Files are kebab-case, types PascalCase, functions camelCase.
- No `any`, `@ts-ignore` or `eslint-disable` without a comment explaining why.
- Errors at boundaries are typed results (`{ ok: false, error }`), not thrown strings.

## Testing Strategy
- `core/` gets unit tests, aiming for ≥ 90% line coverage (it is pure and cheap to test).
- Functions get integration tests with a fake Supabase client and a fake LLM client injected via `deps()`. CI never makes a real Anthropic call.
- One Playwright smoke test against `netlify dev`: the app shell loads and `/api/health` is ok.
- CI (`ci.yml`) runs on every PR and on `main`: install → typecheck → lint → test → build. Red CI blocks merge. The `evals` module adds the eval gate later.

## Boundaries
- **Always:** keep logic in `core/`, validate every external input with zod, write an audit event per step, run `npm run typecheck && npm test` before commits, use conventional commits.
- **Ask first:** new dependencies, changing the DB schema of another module, raising guardrail limits or the budget, making anything public, changing the Netlify or Supabase plan.
- **Never:** commit secrets or `.env`, expose the service-role key to the browser, make the repo or site public (superseded by [SPEC-public-release.md](SPEC-public-release.md)), put real GP documents or the case study's materials in the repo, use any real organisation's logos or branding.

## Success Criteria
1. `gh repo view <repo> --json visibility` → `PRIVATE` (superseded by SPEC-public-release: the project is now public).
2. The Netlify production URL shows a password prompt, and the correct password shows the app shell. A deploy preview is also password-protected.
3. `curl <site>/api/health` (with the password cookie) → all checks `ok`.
   *Criteria 2 and 3 superseded 2026-11-14 (ADR-0006): no password prompt; the API answers 401 without the owner's
   access key and `ok` with it.*
4. Migrations apply cleanly to an empty project, RLS is on for every table, and an `UPDATE audit_events` statement fails.
5. Uploading a 12 MB file, a `.exe` renamed to `.pdf`, or a 31st upload within the hour is rejected with a clear message, and each case has a test.
6. CI passes on `main`, and a PR with a failing test shows red.
7. `git grep -nE "sk-ant-|service_role"` finds no secrets in the repo.

## Questions answered at approval
> **Answered at approval (2026-10-10),** recorded in [CAPABILITY-MAP.md](CAPABILITY-MAP.md) › Decisions recorded at
> approval.

1. **Timeline:** planned backwards from a fixed date about ten days out.
2. **Repository:** private (published later as `gp-report-intelligence`).
3. **Database:** a new Supabase project, with a daily keep-alive ping (the free tier pauses after 7 days without activity).
4. **LLM budget:** $15 a day.
5. **Access:** the password-protected site is the deliverable; repository access only on request.
