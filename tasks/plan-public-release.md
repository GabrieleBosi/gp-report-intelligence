# Implementation plan: public release

Spec: [SPEC-public-release.md](../SPEC-public-release.md) · Tasks: [todo.md](todo.md) › Public release

## Overview
Four phases, each ending in a checkpoint with the full suite green (`typecheck`, `lint`, `test`, `build`, `eval`) and
the markers grep clean for everything touched so far. Phases 1 to 3 are local. Phase 4 is outward-facing and every task
in it waits for the product owner's explicit OK.

## Architecture decisions
- **Remove before adding.** Demo-day material is deleted first, so the scrub never rewrites code that is about to go.
- **The snapshot is an export of the live history** through the API's own read adapters (decided at T8, see the
  spec): the tour's evidence exists only there. The eval stays reproducible from the repository by replay.
- **One switch in `src/lib/api.ts`.** Pages do not know which mode they are in, apart from the banner and the disabled
  live-only controls.
- **The access key is checked in one helper** that every function with a path calls first, and a static test fails if a
  function skips it.
- **The browser runs the real review and posting logic** (`decide()`, `postRun()`), so the snapshot cannot drift from
  what the live system does.

## Dependency graph
```
T1 baseline
 └─ T2 delete demo-day material
     └─ T3 scrub code and tests ─ T4 scrub specs ─ T5 scrub plans and docs      (checkpoint A)
         ├─ T6 access-key gate
         └─ T7 held-out answers ─ T8 snapshot generator ─ T9 api.ts snapshot reads
                                                          └─ T10 in-browser review ─ T11 owner access ─ T12 links and e2e   (checkpoint B)
             T13 ADR and specs ─ T14 README and licence ─ T15 build facts ─ T16 guards and CI ─ T17 GIF                 (checkpoint C)
                 T18 squash ─ T19 repo ─ T20 gate proof ─ T21 site ─ T23 facts                                 (checkpoint D)
```

## Phase 1: remove and scrub
- **T1 Baseline.** `npm ci`; the full suite and eval pass in the working copy; record test and eval counts; first local
  commit. *S*
- **T2 Delete demo-day material** (`deprecation-and-migration`). Delete `ops/`, `core/preflight.ts`,
  `scripts/preflight.ts`, `tests/core/preflight.test.ts` and `npm run preflight`; remove every reference (README,
  showcase content and artefact lists, specs that link them). Acceptance: no reference left (`grep -rn preflight`
  finds nothing outside this plan and the spec); the showcase artefact test passes. *M*
- **T3 Scrub code, config and tests.** `package.json` and lockfile name; script default URLs; the request-guard test
  host; comments in `keep-alive.ts`, `content.ts`, `run.ts`, `models.ts`, `policy.ts`; the sketch's aria-label and its
  e2e assertion; the migration comment (comment only, no SQL change). Acceptance: markers grep clean over everything
  except `*.md`. *M*
- **T4 Scrub the capability map and specs.** `CAPABILITY-MAP.md` and the eight `SPEC-*.md`, using the wording table;
  the first decision becomes "Scope and timeline" and its parser test follows. Acceptance: markers grep clean over
  these files; decisions page test passes. *M*
- **T5 Scrub plans and docs.** Timelines out of `tasks/plan*.md` and `tasks/todo.md` (structure and acceptance kept);
  `docs/` (security audit, acceptance, error analyses; the old gate-proof links removed until T20); `corpus/README.md`;
  a minimal README fix (rewritten in T14). Acceptance: markers grep clean over the whole tree. *M*

### Checkpoint A
- [ ] Full suite and eval pass · [ ] markers grep clean over the tree and a fresh `dist/` · [ ] product owner reviews
  the wording diff

## Phase 2: public mode
- **T6 Access-key gate.** `core/access.ts` (pure, constant-time) and its tests; called first by the shared HTTP helper;
  a static test over every function with a path proves 401 without the key and no database, storage or model call.
  *M*
- **T7 Held-out answers.** `scripts/export-cache-fixtures.ts` copies the held-out documents' answers from `llm_cache`
  into `tests/fixtures/llm` (one read-only query); `evaluateDev(replay, "heldout")` then evaluates all 6 with no miss.
  If any answer is missing: stop and ask before recording. *S*
- **T8 Snapshot export.** `npm run snapshot` exports `public/snapshot/` through the API's own read adapters,
  read-only: corpus documents, the closure of linked runs (latest per document, tour runs, portfolio sources, queue)
  with run views and review state, queue, funds, portfolio, metrics without the upload, page PNGs. Output validated
  by the API's zod schemas in a test; markers scan clean; size under 10 MB. *M*
- **T9 Snapshot reads.** `api.ts` reads the snapshot by default; banner line on every page; upload and "run again"
  disabled with the reason. Tests per read. *M*
- **T10 Review and posting in the browser.** `src/lib/snapshot.ts` keeps in-memory stores and calls `decide()` and
  `postRun()`; the queue and portfolio update; reload resets. Test: same outcome as `decide()` for each queued run. *M*
- **T11 Owner access.** "Owner access" control; key in `sessionStorage`; `Authorization` header on every live call,
  the upload XHR included; a wrong key shows the 401 message. *S*
- **T12 Links and e2e.** Demo-run links and the tour point at snapshot runs; content tests updated; a new e2e spec
  serves the build statically (no functions) and asserts every page renders, a flagged figure can be fixed and posted,
  and no `/api/*` request is made. *M*

### Checkpoint B
- [ ] Full suite, eval and the snapshot e2e pass · [ ] `vite preview` with no functions shows the whole app ·
  [ ] product owner looks at the local site

## Phase 3: documentation and hardening
- **T13 ADR-0006 and spec updates.** `docs/adr/0006-public-snapshot-mode.md`; SPEC-platform's access and password
  sections marked superseded with a pointer; `CAPABILITY-MAP.md` lists `public-release`. *S*
- **T14 README and licence.** README in the spec's order, eval numbers with n and split, Claude Code named, no em
  dashes or banned adjectives (checked by grep); `LICENSE` (MIT, Gabriele Bosi). *M*
- **T15 Build facts.** `showcase:facts` takes the archive path and its GitHub repository for git and CI history
  (read-only); the process page labels them as the development history in a private archive. *S*
- **T16 Guards and CI.** Netlify per-IP rate limits on `upload` and `run-pipeline-background`; budget default $5
  (`.env.example`, docs); gitleaks job pinned to a commit hash. *S*
- **T17 GIF.** Record the review screen fixing the TVPI misprint on the local snapshot build; `docs/media/`; under
  3 MB; embedded in the README with alt text. *S*

### Checkpoint C
- [ ] `code-review-and-quality` and `code-simplification` on the whole diff; `security-and-hardening` on T6 and T16 ·
  [ ] full suite, eval, e2e · [ ] markers grep and gitleaks clean · [ ] product owner reads the README

## Phase 4: publish (each task asks first)
- **T18 Squash.** Orphan branch, one commit of the tree, author `157925677+GabrieleBosi@users.noreply.github.com`,
  dated today; gitleaks over it. Local. *XS*
- **T19 Repository.** *Ask.* Create `GabrieleBosi/gp-report-intelligence` (public), push, CI green. *XS*
- **T20 Gate proof.** *Ask.* A pull request with an unsafe policy change, red on the eval gate, closed unmerged;
  `gate-proof.md` links it and a green `main` run. *S*
- **T21 Site.** *Ask.* Owner sets `LIVE_ACCESS_KEY` and `DAILY_LLM_BUDGET_USD=5` in Netlify; relink the site to the new
  repository; rename to `gp-report-intelligence`; deploy. **Before removing password protection** (checkpoint C
  security review): the owner rotates `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` and redeploys, so deploys
  made before the key check hold dead keys at their permalinks; those deploys are deleted or shown to be protected
  (`verify-deploy.sh` checks an old permalink is refused); the Supabase, Anthropic and access keys are scoped to the
  Production context and fork pull requests need approval before a preview builds. Then remove password protection,
  and verify spec criteria 5 to 7 on the live site, with one owner run. *S*
- **T22 Netlify plan.** No change: the team stays on Pro (decided at plan approval). *none*
- **T23 Portfolio facts.** `../release-private/PORTFOLIO-FACTS.md`, every fact with its source path. *S*

### Checkpoint D
- [ ] Every spec success criterion checked with evidence (`shipping-and-launch`) · [ ] product owner sign-off

## Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Held-out answers missing from `llm_cache` (cache keys changed between versions) | Med | T7 runs before any UI work; a miss stops for an ask, recording costs a few dollars |
| The browser bundle cannot import `core/review` or `core/posting` (node-only imports) | Med | Checked first in T10; both import only pure modules today |
| Snapshot over 10 MB (page images) | Low | Render only pages the review screen links; 110 dpi PNG |
| Editing an applied migration file | Low | Comment-only change; Supabase tracks migrations by version, not content |
| The access key leaks | Med | Per-IP rate limits and the $5 daily cap; the key is rotated in Netlify |
| A marker survives in generated output | High | Grep runs on a fresh `dist/` and `public/snapshot/` at every checkpoint and before the push |
| After relinking, pushes to the private repository no longer deploy | Low | Intended; the archive is read-only from now on |

## Open questions
None. Resolved at spec approval.
