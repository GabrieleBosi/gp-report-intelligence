# Implementation Plan: evals

Scope: [SPEC-evals.md](../SPEC-evals.md) (approved 2026-10-11). Tasks: the "Evals" section of [todo.md](todo.md).

## Overview
Measure first, then gate, then experiment. E1 builds the grading and the first-bad-step attribution as pure code.
E2 assembles the golden set (labels + harvested corrections). E3 runs the dev split by replay and writes the report and
the baseline. E4 turns it into a CI gate and proves the gate bites. E5 adds shadow runs and does the first model
experiment. E6 re-measures held-out on demand and closes the module with its acceptance report.

## Architecture Decisions
- **The eval reuses the replay harness** the tests already use (recorded answers keyed by request): CI pays $0 and a
  changed prompt shows up as a replay miss with the command to re-record it.
- **Attribution needs the intermediate outputs**, so the runner keeps each step's output (classification, round 0,
  final round, route) instead of only the final extraction.
- **Shadow fixtures live beside the production ones** under the candidate's cache keys (the model is part of the key),
  so a candidate can be replayed later without new spend.
- **The baseline is a committed file**: moving it is a reviewed change, never a side effect of a run.

## Dependency graph
```
E1 metrics + attribution ─► E3 runner + report + baseline ─► E4 CI gate ─► E6 held-out + acceptance
E2 golden set + harvest ──┘                                  E5 shadow + first experiment ┘
```

## Tasks (sizes: S < 2 h, M < 4 h)
| Task | Size | Proves |
|---|---|---|
| E1 Metrics and first-bad-step attribution (pure) | M | every metric and every attribution row tested |
| E2 Golden set and harvest | S | labels + analyst corrections, disagreements reported |
| E3 Eval runner, report, baseline | M | `npm run eval` reproduces the measured state, $0, < 2 min |
| E4 CI eval gate | S | a broken normalizer fails CI; reverting passes |
| E5 Shadow runs and the first experiment | M | Sonnet 5.5 per step, side-by-side report, recommendation |
| E6 Held-out on demand and acceptance | S | criteria 1-6 with evidence |

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Attribution guesses wrong for OCR (printed value formats vary) | Med | format the label value with the GP's number style from the corpus profile; unit test per style |
| Shadow spend grows | Low | budget guard per experiment ($2 ask-first), cached candidates |
| A gate that never fails | High | mutation proof in E4 is an acceptance criterion |
