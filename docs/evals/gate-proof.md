# The eval gate fails on a regression (SPEC-evals criterion 2), 2026-10-11

A gate that never fails proves nothing, so it was tested with a deliberate regression on a throwaway branch, CI
started by hand. The first proof ran in the private development repository: a confidence policy that auto-posts every
known-GP report, ignoring failed checks and disagreeing reads, failed the `eval-gate` job
(`Gate: FAIL (route accuracy 75.0% < baseline 91.7%)`), and its revert passed. The proof is repeated on the public
repository below, with links to the runs.

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
