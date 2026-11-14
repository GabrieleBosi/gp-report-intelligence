# Pipeline acceptance (SPEC-pipeline), 2026-10-11

Deployed site, `pipeline@0.11.0`, `policy@2`, every LLM step on `claude-opus-5-5`.
Evidence: live run of all 12 dev documents ([acceptance/2026-10-11-dev.json](acceptance/2026-10-11-dev.json), via
`node scripts/acceptance.ts dev`), the held-out measurement ([acceptance/2026-10-11-confidence.md](acceptance/2026-10-11-confidence.md)),
replay tests in CI, and `usage_ledger` / `pipeline_runs` in Supabase.

## Success criteria
| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `POST /api/runs` returns a run id; the Run page shows the steps live and ends in a final status | pass ¹ | `scripts/verify-deploy.sh` runs a dev document end to end on every deploy: ends `ready_to_post`, 7 steps recorded |
| 2 | Alpenrose PDFs: every key figure and company total equals the label | pass | Q4 2025, Q1 2026 (dev) and Q2 2026 (held-out): 0 differences from the label, live |
| 3 | Every value carries its raw string and page; the page matches the label | pass | the label comparison includes `source.page`; raw strings are stored per round in `extractions.raw` |
| 4 | Trap 1: the critic confirms the TVPI as printed; `tvpi_inconsistent` still fails | pass | critic replay test; live route review, "the report itself may be inconsistent" |
| 5 | Trap 2: NAV filled by the vision fallback, marked as an image read | pass | replay test (exact label equality); Run page IMAGE badge; confidence marks it correlated → review |
| 6 | Tessera (unknown GP) extracted but marked unknown | pass | held-out: 0 differences from the label, route triage, no read-B call |
| 7 | Replay tests in CI with zero API calls; full suite under 30 s | pass | 420 tests in 10.3 s; replay LLM client throws on a missing recording |
| 8 | A run over the daily budget is refused before any LLM call, and the UI says so | pass ² | `POST /api/runs` answers 429 with the message shown under the Run button (`core/run-request.ts`); each LLM call is also refused when its estimated cost would cross the cap |
| 9 | Median wall-clock: native PDF < 90 s, scan < 4 min | pass | fresh runs: native PDF median **31.6 s** (max 57.8 s, a two-round critic); scan median **42.8 s**; workbook 17.7 s |
| 10 | Cost per native-PDF run recorded and shown on the Run page; target < $0.40 | pass | fresh runs: native PDF median **$0.105** (max $0.162); scan $0.105; workbook $0.072. Cached reruns: $0 |

¹ The spec text says "returns 202". The API creates the run (201) and starts it with a second call (202), because a
function cannot call the password-protected site over HTTP (`netlify/functions/runs.ts`). Final statuses are now the
confidence outcomes (`ready_to_post`, `needs_review`, `needs_triage`) instead of `extracted`.
² Not met until this task: the budget was only enforced at the first LLM call inside the background run.

## Live run of the dev split (12 documents)
| Outcome | Documents |
|---|---|
| Route as labeled | 11 of 12 |
| Auto-posted with any difference from the label (unsafe) | **0** |
| Exact extraction (0 differences) | 10 of 12: all native PDFs, both workbooks, the chart and misprint traps |
| Differences only in non-key fields | the 2 scans: OCR-lost EBITDA decimals (now flagged by the EBITDA ≤ revenue check), country codes, narrative typos |
| Route differs from label | `nordkap-iii-2026q1-scan`: every key figure high, but review, because two OCR-damaged country codes are normalization issues (routing rule 2, confirmed by the product owner) |

Held-out (measured once, no tuning): 5 of 5 routes as labeled, 0 differences.

## Cost and latency by format (fresh runs, no cache)
| Format | Runs | Median time | Median cost | Read B |
|---|---|---|---|---|
| Native PDF | 4 | 31.6 s | $0.105 | page images, ~$0.03 |
| Scanned PDF (OCR) | 2 | 42.8 s | $0.105 | page images, ~$0.03 |
| Excel workbook | 1 | 17.7 s | $0.072 | cell lookup, $0 |

At $0.10 per report, the daily $15 budget covers about 140 fresh reports. Reruns of an unchanged document are served
from `llm_cache` at $0.
