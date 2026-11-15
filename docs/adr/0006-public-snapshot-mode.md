# ADR-0006: A public site that reads a recorded snapshot; live functions behind the owner's key

Status: Accepted · 2026-11-14 (SPEC-public-release W2). Supersedes the visitor access in SPEC-platform (a site-wide
password).

## Context
The project becomes a public portfolio piece. A visitor should see the whole system with no login: the documents, the
runs step by step, the review screen, the portfolio system and the evals. Three things rule out simply removing the
password. Every pipeline run calls the model, so a public "run" button spends money. The review and posting endpoints
write to append-only tables, so visitors would change the demo for each other and could not undo it. And the live
database holds residue from end-to-end tests that a public site would show as if it were real activity.

## Decision
- **The public site reads static files.** `npm run snapshot` (owner only, read-only queries) calls the API's own GET
  handlers and writes their responses to `public/snapshot/`, mirroring the API paths (`/snapshot/api/runs/<id>.json`),
  with page images rendered from the corpus files. It exports the live history rather than replaying the pipeline:
  the tour's evidence (the analyst-approved TVPI misprint, the superseded Sonnet run) exists only there. Uploaded
  documents and their runs are left out. The result is committed: 18 documents, 56 runs, 32 page images, 5.8 MB.
- **One switch.** `src/lib/api.ts` reads the snapshot unless the owner's key is set. Starting a run and uploading are
  refused in the browser, with the reason shown, before any request is made.
- **The review works in the visitor's browser.** Accept, correct, reject, assign and approve run the server's own code
  (`handleReview`, `decide`, `buildReviewState`, `postStoredRun`) against in-memory stores. The three SQL functions the
  server calls instead (`apply_review_decision`, `portfolio_post`, `complete_posting`) are mirrored rule for rule in
  `core/snapshot.ts`, each rule with a test. A reload starts from the snapshot again.
- **Live mode needs the owner's key.** Every function with a path is wrapped in `withAccess`: a constant-time
  comparison of `Authorization: Bearer <key>` against `LIVE_ACCESS_KEY` (at least 32 characters), `401` otherwise,
  before any database, storage or model call. "Owner access" in the header checks a key against `/api/health` before
  keeping it for the browser tab (`sessionStorage`). Page images in live mode are fetched with the key, since an
  `<img>` cannot send it.
- **Backstops if the key leaks:** the daily model budget, and per-IP rate limits on the paths that spend or write
  (the plan allows 5 rules), tighter on upload and pipeline runs. The key is rotated in Netlify. The read-only paths
  are not limited: a flood of refused requests costs invocations but changes and spends nothing.

## Consequences
- The default path costs $0 and changes nothing: no request from the public site reaches a function. A browser test on
  the static build with no functions fails if any page requests `/api/`.
- The numbers a visitor sees are dated: the banner gives the export date and the evals page labels the counts as
  recorded. A new export is a deliberate, reviewed commit.
- The SQL mirrors can drift from the migrations. A change to one of the three SQL functions must change its mirror and
  its test; the snapshot contract test and the in-browser review tests read the committed snapshot to catch a mismatch
  in shape.
- Names typed by analysts during development (the owner's and "E2E analyst") are part of the exported history.
- The live end-to-end tests need the key in `.env`; the snapshot test needs no secrets.
- The budget is checked before each model call and the cost recorded after it, so runs in parallel can each pass the
  check: spend can exceed the daily budget by about one call per run in flight. Accepted: a few dollars at most.
- Deploys made before the key check keep their own functions and environment at their permalinks. Removing the site
  password therefore comes after rotating the service and model keys and removing or protecting those deploys.

## Alternatives considered
- **Keep the site-wide password:** rejected. A portfolio link behind a password is not read.
- **Remove the password and rely on rate limits and the budget cap:** rejected. Visitors could still spend up to the
  cap every day and would see each other's decisions in an append-only history.
- **Regenerate the snapshot by replaying the pipeline at one version:** tried first and dropped. It loses the tour's
  evidence and needs in-memory copies of about ten stores.
