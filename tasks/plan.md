# Implementation Plan: platform + corpus

Scope: the two approved module specs, [SPEC-platform.md](../SPEC-platform.md) and
[SPEC-corpus.md](../SPEC-corpus.md). Later modules get their own spec → plan cycle.
Tasks: [tasks/todo.md](todo.md).

## Overview
Build a walking skeleton first: a private repo, CI, a password-protected Netlify
site and Supabase, deployed and healthy on day 1. Then build the corpus as a
vertical slice. One fictional GP's report (Alpenrose) goes from generator to
label, verification, storage and the list on the live site. After that the
corpus broadens to all formats and traps, and the upload path with its
guardrails is added. `pipeline` can start as soon as the Alpenrose slice exists,
without waiting for the whole corpus.

## Architecture Decisions
- **`core/` is pure TypeScript** (no Netlify/React/Supabase imports). Dependencies are injected via a `deps()` object, so functions are thin adapters and every rule is unit-testable with fakes. → ADR-0001
- **Pipeline runs in Netlify background functions**, and the UI polls `pipeline_runs.status`. Sync functions time out long before a 2-step LLM read on a scan. → ADR-0002
- **The browser has no Supabase access.** RLS denies everything, and the service-role key exists only in functions. Fewer moving parts than auth plus policies, for a site that is already behind a password. → ADR-0003
- **The financial identities live in `core/checks/identities.ts`.** They are written once, used by the corpus verifier now and by the pipeline checks (step 5) later, so the labels and the runtime cannot drift apart.
- **Corpus files are committed**, and generator tooling (poppler/ImageMagick) is a local-only dependency. CI stays fast and hermetic.
- **Data before rendering.** The generator builds a consistent fund first, then renders it. Traps are explicit, render-time-only mutations recorded in the label.

## Dependency graph
```
T1 scaffold+CI ─┬─ T2 GitHub repo ── T3 Netlify+health ── T4 Supabase+migrations ─┐
                │                                                                  │
                └─ C1 schema v1 ── C2 generator+identities ── C3 Alpenrose slice ──┴─ C4 seed + documents page
                                                         │                              │
                                                         ├─ C5 Harbourline+Nordkap      ├─ T5 upload guardrails (core)
                                                         ├─ C6 Meridian XLSX            │    └─ T6 upload function + UI + budget cap
                                                         ├─ C7 traps + Tessera          │
                                                         └─ C8 scans ─── C9 verify+README ── T7 e2e smoke
```
Parallel-safe once C2 is done: C5, C6, C7 (they touch separate renderers). Sequential: migrations (T4 → C4 → T6).

## Phases
1. **Walking skeleton:** T1–T4, then a checkpoint (deployed, password-protected, health ok).
2. **First vertical slice:** C1–C4, then a checkpoint (an Alpenrose report is visible on the live site, and its label is verified).
3. **Breadth + uploads:** C5–C9, T5–T7, then a checkpoint (all platform and corpus success criteria met).

## Cut order
**Cut order if late** (last to first): shadow-version comparison → Meridian XLSX path → triage-queue polish → the trap 2 (chart-only) vision fallback. Never cut: the confidence matrix, the review UI, the eval gate, `showcase`.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Netlify/Supabase CLI auth needs an interactive login | Med (blocks T3/T4) | You run `! npx netlify login` once. Supabase is created through the connected Supabase connector (asks for cost confirmation) |
| Password protection can only be set in the Netlify UI | Low | You toggle it in Site config → Access & security right after T3. The checkpoint verifies it |
| Zurich region (eu-central-2) not offered by Supabase | Low | Fall back to eu-central-1 (Frankfurt) and note it in ADR-0003 |
| pdfkit output not byte-deterministic (IDs, timestamps) | Med | Fix `info.CreationDate` and the doc ID. If still unstable, compare text plus normalized hash and note the deviation in the spec |
| Free Supabase project pauses after 7 days without activity | High | Scheduled keep-alive ping |
| Corpus breadth eats pipeline time | High | Pipeline starts on the Alpenrose slice after Phase 2. C5–C8 can run in parallel subagents |
| Background functions behave differently under `netlify dev` | Med | Verify one background invocation on a deploy preview in T3, before the pipeline depends on it |

## Open Questions
- None blocking. You'll be needed for: `npx netlify login` (T3), the Netlify password toggle (after T3), confirming the Supabase project creation (T4), and the Anthropic API key (not until `pipeline`).
