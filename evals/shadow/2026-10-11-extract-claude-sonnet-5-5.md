# Shadow run · extract on claude-sonnet-5-5 · 2026-10-11

**Verdict: eligible.** No gated metric is worse on the dev split; claude-sonnet-5-5 on extract saves $0.41 (50%) per pass. Switching changes production: ask first.

| Metric | Baseline (claude-opus-5-5) | Candidate |
|---|---|---|
| Unsafe auto-posts | 0 | 0 |
| Key-figure accuracy | 100.0% | 100.0% |
| All-figure accuracy | 99.6% | 99.6% |
| Classification accuracy | 100.0% | 100.0% |
| Route accuracy | 91.7% | 91.7% |
| Cost of step "extract" (12 documents) | $0.820 | $0.408 |
| Cost of the whole pass | $1.291 | $0.879 |

Live candidate calls: 49 (median 2.7 s); new spend for this experiment: $0.408 (cap $2.00).

Candidate errors:
- harbourline-ii-2025q3-tvpi-misprint-scan · Luori Inc.: ebitda_ltm · step 3
- harbourline-ii-2025q3-tvpi-misprint-scan · Tovbren Inc.: ebitda_ltm · step 3
- harbourline-ii-2025q3-tvpi-misprint-scan · Tracen Inc.: ebitda_ltm · step 3
- nordkap-iii-2026q1-scan · route review, expected auto_post · step 7
