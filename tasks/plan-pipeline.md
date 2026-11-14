# Implementation Plan: pipeline

Scope: [SPEC-pipeline.md](../SPEC-pipeline.md) (approved 2026-10-11). Tasks: the "Pipeline" section of [todo.md](todo.md).
This plan sits alongside [plan.md](plan.md) (platform + corpus), whose remaining tasks (C5–C9, T5–T7) are interleaved
below rather than replaced.

## Overview
Risk-first, then vertical. Two spikes prove the riskiest assumptions (page rendering and OCR inside Netlify functions)
before anything depends on them. The pure-code normalizer is built next, since it needs no LLM or I/O. Then a run
becomes visible end to end (API → background function → Run page) before the LLM steps fill it in:
classify → extract → critic → vision fallback. Scans and XLSX come last, once their corpus documents exist.

## Architecture Decisions
- **`core/pipeline/run.ts` is a plain step list**, not a framework. Each step is `(ctx, deps) => Promise<ctx>`, and the runner
  wraps every step with a budget check, an audit event, timing and error capture. It's easy to test and easy to show on screen.
- **`LlmClient` port with three implementations:** Anthropic (live), replay (fixtures, used in CI) and record (live + write fixture).
  The replay key is sha256(model, prompt id@version, effort, input), so a prompt change produces a visible fixture miss,
  never a silent stale answer.
- **Extraction output = raw strings + page.** Normalization lives in code (`core/pipeline/normalize.ts`). This is the
  testable heart of "LLM only where code can't".
- **One `extractions` row per round** (0 first pass, 1–2 critic rounds), append-only like the audit log.
- **Run status lifecycle:** `queued → running → extracted | failed`. `confidence` extends it later (`needs_review`,
  `needs_triage`, `posted`).

## Dependency graph
```
P1 render spike ──┐                       P9 normalizer (pure) ─────────────┐
P2 OCR spike ─────┤                                                          │
                  │   P3 LLM port ──┐                                        │
                  │                 ├─ P4 run lifecycle API ─ P5 parse (text) ─ P6 Run page
                  │                 │                                         │
                  │                 └──────────── P7 classify ── P8 extract ──┴─ P10 critic ─┐
                  └───────────────────────────────────────────── P11 vision fallback ◄──────┤ (needs C7 trap 2)
C6 xlsx, C8 scans ───────────────────────────────────────────── P12 OCR + XLSX parse        │
                                                                 P13 acceptance + cost ◄─────┘
```

## Execution order (all open tasks, both plans)
| Order | Tasks | Why here |
|---|---|---|
| 1 | P1, P2 | Fail fast on the two riskiest assumptions |
| 2 | P9 | Pure code, no dependencies, the core of step 5 |
| 3 | P3 → P4 → P5 → P6 | A run is visible end to end on the live site |
| 4 | P7 → P8 | **Checkpoint:** Alpenrose extracted |
| 5 | C5, C7 (corpus breadth + traps) | Traps are needed by P10/P11 acceptance; parallel-safe with P8 |
| 6 | P10 → P11 | Critic + vision fallback, proven on traps 1 and 2 |
| 7 | C6, C8, C9 → P12 | Scans and XLSX need their corpus docs |
| 8 | T5, T6, P13, T7 | Uploads, live acceptance, end-to-end smoke |

Parallel-safe (separate files): P9 alongside P3–P6; C5/C7 alongside P7/P8. These can go to subagents in their own git worktrees.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| `@napi-rs/canvas` won't bundle or run in Netlify functions | High | P1 spike first; approved fallback = render at ingest |
| tesseract.js too slow or too large for a background function | Med | P2 measures it; fallback = OCR at ingest locally for the corpus, and uploads of scans run OCR in the background fn with a longer timeout |
| Opus 5.5 cost makes eval runs eat the $15/day budget | Med | Replay cache makes repeat runs free; record fixtures once per prompt version |
| Structured-output helper names differ from memory | Low | Source-driven: read the SDK docs (claude-api skill) before writing P3 |
| Critic "repairs" an inconsistent source (trap 1) | High (wrong number posted) | Prompt rule + test with a recorded trap-1 response; confirmed_as_printed must keep the flag |
| Pipeline accidentally reads `corpus_meta` | High (eval leakage) | Lint rule: `core/pipeline/**` and `netlify/functions/run-*` may not reference `corpus_meta`; test asserts it |

## Open Questions
- None blocking. Live LLM calls start in P3 and spend real money within the $15/day cap; I'll report the cost of each recording.
