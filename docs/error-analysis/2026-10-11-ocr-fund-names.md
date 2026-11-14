# Error analysis: OCR damages fund names, scans go to triage (dev, 2026-10-11)

Found while building P12 (OCR path), on the two **dev** scans. No prompt or code was tuned on held-out data.

## What happened
| Document | Key figures | Classification | Route it would take |
|---|---|---|---|
| `harbourline-ii-2025q3-tvpi-misprint-scan` | all exact (6 fund + 7 company totals) | fund name OCR'd as "Harbourline Growth **\|\|**" → unknown fund | triage (expected review) |
| `nordkap-iii-2026q1-scan` | all exact (6 fund + 5 company totals) | fund name OCR'd as "Mid-Market II**]**", model returned "Mid-Market **II**" → unknown fund | triage (expected auto-post) |

OCR quality is high (mean word confidence 91 and 92), and every key figure is right. The failure is the **first bad
step**: step 3 (OCR) turns the roman numeral "II"/"III" into `||` or `II]`. Step 2 (classify) then reports what it
reads, and the registry match (exact after normalization) finds no fund.

## Why the current behaviour is safe
The registry match **failed closed**: "Mid-Market II" was not matched to "Mid-Market III" (a real GP may run both
funds), so nothing could be posted to the wrong fund. Triage puts the document in front of an analyst. A test now
guards this (`formats-replay.test.ts`: a misread fund name is never matched to a fund).

## Other OCR errors, all in non-key fields (do not gate routing)
- **EBITDA 10x too large** for 3 Harbourline companies: the decimal point was lost (`72.4` → `724`). No identity
  check covers operating metrics, so this would be stored wrong. Cheapest guard: a plausibility check "EBITDA ≤
  revenue" (every case here would fail it: margins above 100%), which also sends the figure to the critic.
- Country codes unreadable for 3 companies (stored as null, with a normalization issue).
- Narrative typos ("cast programme", "portfolia").

## Fix options (cheapest first), for a decision
1. **Classify scanned documents from the page-1 image as well as the OCR text** (classify@2, only when page 1 is
   OCR'd). The title is clear in the image. Cost about $0.01 per scan; no matching rule changes; prompt change
   recorded on dev.
2. **OCR-tolerant registry match within the same GP** (`|`, `l`, `1`, `]` ~ `I`), with a review reason "fund name
   matched approximately". Free, but it is a matching and policy change (what gets posted), and it can still pick the
   wrong fund when a GP has funds II and III.
3. **Keep triage** for scans with an unknown fund: safest, costs analyst time on every scan with a damaged title.

Plus, independently: the "EBITDA ≤ revenue" plausibility check above.

## Decision and result (2026-10-11)
Option 1 chosen. `classify-scan@1` (only when page 1 was OCR'd) adds the page-1 image and tells the model to read
names from it; text documents keep `classify@1`, so no other fixture changed. Recorded on the two dev scans:
- both classify exactly and match the registry (fund III, fund II);
- trap-1 scan → **review** as designed ("the report itself may be inconsistent");
- Nordkap scan → every key figure **high**, but **review**, because OCR left two company country codes unreadable and
  policy@1 blocks auto-post on any normalization issue. SPEC-confidence states both "auto_post requires no
  normalization issue" (routing rule 2) and "only key figures gate routing" (decision 5); which one wins is an open
  policy question for the product owner, not tuned here.
The "EBITDA ≤ revenue" plausibility check remains a proposal.
