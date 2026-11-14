# Eval report · pipeline@0.13.0 with classify, extract, confidence on claude-sonnet-5-5 (heldout) · 2026-10-11

Gate: **FAIL** (1 unsafe auto-post (must be 0))

| Metric | Value |
|---|---|
| Documents | 6 |
| Unsafe auto-posts | 1 |
| Key-figure accuracy | 98.6% |
| All-figure accuracy | 99.7% |
| Classification accuracy | 100.0% |
| Route accuracy | 83.3% |
| Recorded cost | $0.29 |

## Errors by first bad step

| Step | Errors |
|---|---|
| 4 extract | 1 |

## Documents

| Document | Format | Route | Expected | Key figures | All figures |
|---|---|---|---|---|---|
| alpenrose-iv-2026q2 | native_pdf | auto_post | auto_post | 12/12 | 57/57 |
| harbourline-ii-2026q2 | native_pdf | auto_post | auto_post | 13/13 | 65/65 |
| meridian-i-2026q2 | xlsx | auto_post | auto_post | 11/11 | 49/49 |
| nordkap-iii-2025q3-restatement | native_pdf | auto_post | review | 10/11 | 48/49 |
| nordkap-iii-2026q2 | native_pdf | auto_post | auto_post | 11/11 | 49/49 |
| tessera-seed-i-2026q2 | native_pdf | triage | triage | 14/14 | 73/73 |

## Every error

- nordkap-iii-2025q3-restatement · nav (key): got 363,979,000, expected 349,420,000 · step 4 extract

Live spend: $0.288 (cap $2.00). Not evaluated: none.
