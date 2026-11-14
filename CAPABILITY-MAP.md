# Capability Map: GP Report Document Intelligence

Status: **approved** 2026-10-10

A working version of the system I sketched in response to a business case given to me in a hiring process: private equity GP fund reports go through a
system → AI → analyst pipeline with a continuous improvement loop. The site
also shows how it was built, following the agent-skills flow
(spec → plan → tasks → build → test → review → ship).

| Module id | Responsibility | Depends on |
|---|---|---|
| `platform` | Private GitHub repo, CI, password-protected Netlify site, Supabase (Postgres, Storage, audit tables), secrets, upload guardrails | — |
| `corpus` | Synthetic GP quarterly reports (native PDF, scanned PDF, XLSX, unknown GP) + golden labels; canonical extraction schema v1 | — |
| `pipeline` | Steps 1–6: receive + store raw, classify, parse/OCR + vision fallback, extract per section to a JSON schema, normalize + financial checks, critic (max 2 rounds) | platform, corpus |
| `confidence` | Step 7: per-field confidence from two signals, (A) whether the financial checks pass and (B) whether the text read and the vision read agree → route | pipeline |
| `review` | Step 9: accept / fix / reject with the source shown alongside; triage queue for unknown GPs or layouts; corrections saved as feedback | confidence |
| `posting` | Step 8: mock internal-system API + append-only audit log | confidence, review |
| `evals` | Golden eval set, eval runner, CI eval gate, error analysis to find the first bad step, shadow comparison of prompt/model versions | corpus, pipeline, confidence, review |
| `showcase` | Explanation of the process: architecture, mapping from business requirements to technical choices, specs/plans/ADRs, live eval metrics | all |
| `public-release` | Added 2026-11-14: public repository, public site reading a recorded snapshot, live functions behind the owner's access key ([ADR-0006](docs/adr/0006-public-snapshot-mode.md)) | all |

Build order: `platform`, `corpus` → `pipeline` → `confidence` → `review`, `posting` → `evals` → `showcase` → `public-release`

## Decisions recorded at approval
- Scope and timeline: **about ten days** of build time, planned backwards from a fixed date. If time runs short, cut scope; `showcase` must never be left empty.
- Defaults accepted: a private repository (published later as `gp-report-intelligence`, see [SPEC-public-release.md](SPEC-public-release.md)), new Supabase project, $15/day LLM budget, 18-doc corpus, "Fictional" footer on each report.
- Demo inputs: preloaded corpus **and** live uploads (guardrails in `SPEC-platform.md`).
- LLM provider: Anthropic Claude (text + vision).
- Language: English.

## Module specs
- [SPEC-platform.md](SPEC-platform.md): approved 2026-10-10
- [SPEC-corpus.md](SPEC-corpus.md): approved 2026-10-10
- [SPEC-pipeline.md](SPEC-pipeline.md): approved 2026-10-11
- [SPEC-confidence.md](SPEC-confidence.md): approved 2026-10-11
- [SPEC-review.md](SPEC-review.md): approved 2026-10-11
- [SPEC-posting.md](SPEC-posting.md): approved 2026-10-11
- [SPEC-evals.md](SPEC-evals.md): approved 2026-10-11
- [SPEC-showcase.md](SPEC-showcase.md): approved 2026-10-11
- [SPEC-public-release.md](SPEC-public-release.md): approved 2026-11-14
