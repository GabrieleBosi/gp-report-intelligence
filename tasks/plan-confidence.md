# Implementation Plan: confidence

Scope: [SPEC-confidence.md](../SPEC-confidence.md) (approved 2026-10-11). Tasks: the "Confidence" section of [todo.md](todo.md).

## Overview
The core first, then the call around it, then the proof. K1 builds the whole decision as pure code: policy, read-A/B
comparison, the per-figure matrix and the routing, all table-driven and testable without an LLM. K2 adds read B and the
step that stores the assessment and sets the final run status. K3 proves it on the dev corpus by replay (routes equal
the labels, plus the safety property). K4 makes it visible. K5 is the live acceptance and the held-out measurement.
The XLSX read B (a cell lookup) waits for the spreadsheet path (K6, after P12).

## Architecture Decisions
- **The decision is a pure function:** `assess(evidence, policy) -> { fields, level, route, reasons }`. No I/O and no
  LLM; one table row per matrix case, one test per row. This is the part an auditor or regulator would ask to see.
- **Read B is the only new LLM call.** A dedicated `read-b@1` prompt over page images; its input never contains read-A
  values (asserted by a test on the request text).
- **The comparison reuses the step-5 normalizer:** B's raw strings get the same unit statement and per-document
  separators, so "agree" means equal values, not equal strings.
- **The final status comes from the last step:** the run engine finishes with `ctx.finalStatus` when set
  (`ready_to_post`, `needs_review`, `needs_triage`), otherwise `extracted`.
- **Assessments are append-only and record the policy version**, so "why was this posted?" has a stored answer.

## Dependency graph
```
K1 core (policy, compare, assess) ─► K2 read B + step + migration ─► K3 replay proof ─► K5 live acceptance + ADR
                                                         └────────► K4 Run page panel ┘
P12 (XLSX parsing) ─► K6 XLSX read B (cell lookup)
```

## Execution order (all open work)
K1 → K2 → K3 → K4 → K5 → C6 → C8 → C9 → P12 → K6 → T5 → T6 → P13 → T7, then `review` / `posting` (specs first),
`evals`, `showcase`.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Read B disagrees on formatting, not substance (e.g. "1,40x" vs "1.40x") | Med (needless reviews) | Compare after normalization, never raw strings; unit tests per corpus style |
| Read B mislabels which company a total belongs to | Med | Align by normalized name; an unmatched company counts as "B unavailable" (medium), never as disagreement on the wrong row |
| Too many reviews (low straight-through processing) | Low for the demo | Measured by the evals; the policy is versioned and changes only with approval |
| Held-out restatement routed auto_post if the footnote marker is lost in parsing | High (wrong NAV posted) | Footnote rule reads the raw string; unit test with each marker type; live held-out measurement reported as is |

## Open Questions
None blocking. Read B fixtures for 8 dev documents cost roughly $0.25 to record.
