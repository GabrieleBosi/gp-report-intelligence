# Error analysis: portfolio section under-extracted (held-out Q2 2026)

Date: 2026-10-11 · Pipeline: `pipeline@0.4.0` (`extract-portfolio@1`, claude-opus-5-5, effort medium)

## What happened
Live acceptance run on `alpenrose-iv-2026q2` (held-out split). Fund figures were all correct, but the portfolio
section returned **1 of 6 companies** (Morlin GmbH), with its country missing. The output was complete, valid JSON:
the model stopped early. This was not truncation.

## How it was caught
Signal A: `nav_bridge_gap` failed (sum of company unrealized 86.8m vs fund NAV 420.8m). With step 7 in place this run
routes to human review instead of posting five missing companies. The checks did their job.

## First bad step
Step 4, `extract-portfolio@1`. Classify, parse and normalize were correct (0 normalization issues).

## Reproduction (dev split only)
The same prompt, 3 uncached live calls on each dev document: **6/6 companies every time**, all countries present
($0.16). Not reproducible on dev, so this is a stochastic under-extraction (about 1 in 9 portfolio calls observed so far).

## Decisions
- **No prompt change from this case.** The prompt is correct on dev; tuning it to a held-out document would
  invalidate the held-out score (SPEC-corpus).
- **Recovery belongs to the critic (P10).** It re-reads *named* fields, but missing companies have no field paths, so
  `nav_bridge_gap` makes the critic re-extract the **whole portfolio section** (P10 acceptance updated).
- **Cache:** the bad answer is cached (key = model, prompt version, input), so re-running Q2 reproduces the failure
  until P10. It is kept as a real, reproducible "caught by checks" case. To decide in P10: whether a step's answer
  that fails its checks should be cached at all.
- **Eval set:** once evals exist, this failure mode is added as a case: the eval must catch an under-extracted
  portfolio, whether by checks or by field-level comparison.

## Resolution (P10, `pipeline@0.5.0`)
The critic re-reads the whole portfolio table when `nav_bridge_gap` fails (`critic-portfolio@1`, a distinct prompt so
the cached under-extraction is not replayed). Live re-run of the same held-out document, with the bad answer still
cached for step 4: the critic recovered **1 → 6 companies**. Round 1 matches the label with **0 differences**, every
check passes, and the run cost $0.028 (the earlier steps were served from the cache). Round 0 (the failure) and round 1
(the recovery) are both kept in `extractions`, so the audit trail shows what was wrong and how it was fixed.

Closing the improvement loop from the process sketch: error analysis (first bad step: extract) → fix the cheapest
place (a targeted re-read, not a new extraction prompt) → verified without tuning on the held-out document.
