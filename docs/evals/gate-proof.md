# The eval gate fails on a regression (SPEC-evals criterion 2)

A gate that never fails proves nothing, so it is tested with a deliberate regression. On this repository, 2026-11-14:

| | Change | Eval gate | Run |
|---|---|---|---|
| [Pull request #1](https://github.com/GabrieleBosi/gp-report-intelligence/pull/1), closed unmerged | `core/confidence/assess.ts`: every known-GP report auto-posts, whatever the checks and the second read say | **fail**: `Gate: FAIL (route accuracy 75.0% < baseline 91.7%)` | [red](https://github.com/GabrieleBosi/gp-report-intelligence/actions/runs/43636302579) |
| `main`, the initial commit | none | pass: 0 unsafe auto-posts, every gated metric at its baseline | [green](https://github.com/GabrieleBosi/gp-report-intelligence/actions/runs/43635980281) |

The same change also failed 16 unit tests (the confidence matrix, and the held-out replay, whose route accuracy fell to
83.3%), so it could not pass CI by either route. The proof was first run the same way in the private development
repository on 2026-10-11, with the same result, and its revert passed.

## What else the attempt showed
- **A broken normalizer (NAV × 1.001)** was tried first. It makes the TVPI check fail, so the critic asks the model a
  question that was never recorded: the eval cannot judge the change until it is re-recorded. The runner used to crash
  on that; it now lists the documents it could not evaluate with the re-record command and fails. Either
  way the change cannot pass CI.
- Unsafe auto-posts stayed 0 under the policy regression because every dev key figure is still extracted correctly;
  the gate caught the regression through route accuracy. A regression that auto-posted a wrong key figure would fail on
  the unsafe rule (unit-tested in `tests/core/evals/evals.test.ts`).
- My own slips along the way, kept for honesty: the first mutation's comment swallowed the rest of its line (a crash,
  not a verdict), and a mistyped `git revert` made one "after revert" run test the broken commit again; both were redone
  before recording the results above.
