# Error analysis: the Sonnet switch auto-posted a restated NAV (held-out, 2026-10-11)

## What happened
After the approved switch of classify, extract and read B to Claude Sonnet 5.5 (`pipeline@0.12.0`), the held-out split
was measured once on the live site ([evidence](../acceptance/2026-10-11-heldout-pipeline-0.12.0.json)): 5 of 6 routes
as labelled, and **`nordkap-iii-2025q3-restatement` auto-posted with a wrong NAV** (unsafe). The run was posted to the
mock portfolio system as Nordkap Mid-Market III, Q3 2025, version 1, NAV 363.979m (label: 349.420m).

## Why (first bad step: 4, then 7)
| | Opus 5.5 (before) | Sonnet 5.5 (0.12.0) |
|---|---|---|
| Read A NAV (step 4) | 349.420, the **revised** value from the footnote | 363.979, the **table** value, no footnote marker |
| Checks (step 5) | TVPI and RVPI fail (the multiples use the old NAV) | all pass: the table NAV is consistent with every ratio |
| Read B NAV (step 7) | 349.420 | **363.979¹**, with the footnote marker |
| Footnote rule | not triggered | **not triggered: it only inspects read A's raw string** |
| Route | review | auto_post (unsafe) |

The trap is designed exactly for this (`corpus/generator/traps.ts`): "a reader that takes the table value instead gets a
wrong NAV that is consistent with the ratios, which no check can catch". Opus read the footnote; Sonnet read the table.
The independent second read *did* see the footnote, but the policy did not look at it.

## Why the dev evals did not show it
The dev split holds no restatement (it is the held-out trap by design), and the shadow runs replayed only dev
documents. This is the case SPEC-evals keeps a held-out split for: measured after a change, never tuned on.

## Actions taken
- **Rolled back at once** to all-Opus (`pipeline@0.12.1`): the last configuration measured safe on
  held-out. Live re-run: review, 0 differences.
- The wrong record stays in the mock portfolio system's history (append-only); it can only be superseded.

## Fix options (for a decision)
1. **Footnote rule on either read (policy@3):** a footnote marker in read A *or* read B makes a key figure medium, so it
   never auto-posts. Deterministic, free, and it would have stopped this case under both models. Disclosure as in
   SPEC-confidence decision 3: the rule change is motivated by a held-out failure, so the next held-out result for this
   document is not an unbiased measurement; the rule targets a general pattern (a second read seeing a qualification the
   first read missed), not this document.
2. **Re-measure the Sonnet switch after option 1,** on held-out again, reported as is.
3. **Supersede the wrong record:** re-run the restatement (it now goes to review), the analyst sets the NAV to the
   revised 349.420 from the footnote and approves; posting creates version 2, superseding the wrong version 1.

## Follow-up (decisions 1-3, same day)
1. **policy@3 shipped** (`pipeline@0.13.0`): a footnote marker in either read keeps a key figure from
   auto-posting.
2. **Re-measured the Sonnet configuration on held-out, without switching production** (`npm run eval:candidate`, live,
   [report](../../evals/candidates/2026-10-11-heldout-classify+extract+confidence-claude-sonnet-5-5.md)): **still 1
   unsafe auto-post**, the restatement. Variance check on that document, 3 runs per model:

   | Model | Read A NAV | Read B NAV |
   |---|---|---|
   | Sonnet 5.5 | 363.979 ×3 (the table value, every time) | 363.979, 363.979¹, 363.979¹ (marker 2 of 3) |
   | Opus 5.5 | 349.420 ×3 (the revised value) | 349.420 ×3 |

   Sonnet's read A systematically takes the table value over a restatement footnote; policy@3 catches it only when
   read B happens to print the marker. **Conclusion: Sonnet 5.5 is not safe for extraction on such reports; production
   stays on Opus 5.5 for every step.** (A narrower switch, classify and read B only, would be safe in principle, since
   a disagreeing read B only sends more to review, but it saves about 17% of a pass and is a separate decision.)
3. **Wrong record superseded:** the restatement re-run on Opus went to review with the revised NAV 349.420; the analyst
   accepted the flagged figures and approved with the reason; posting created **version 2 (NAV 349.42m), superseding
   version 1** (run `db8c283a`).

## Lessons
- The dev split could not reveal this: the only restatement is held out. The held-out measurement after the switch did
  exactly its job, and the gate rule "zero unsafe auto-posts" (not an average accuracy) is what made it visible.
- A cheaper model can hold every average metric and still fail one rare, consequential case: model changes are
  measured on held-out before they ship, not after.
