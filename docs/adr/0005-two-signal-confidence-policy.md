# ADR-0005: Confidence from two independent signals, decided by code

Status: Accepted · 2026-10-11 (SPEC-confidence, policy@1)

## Context
Step 7 of the sketch asks "confidence high?" before anything is posted to the portfolio system without a human. The
business priority is (1) never post a wrong key figure, then (2) maximise straight-through processing. Two common
shortcuts fail priority 1: a model's self-reported confidence is not calibrated, and financial checks alone cannot see a
misread that still adds up within tolerance.

## Decision
- **Two signals per key figure:** A = do the financial identities involving it pass (after the critic)? B = does an
  **independent** read from the page **image** give the same value as the text read?
- **Independence is enforced, not hoped for:** read B (`read-b@1`) is told which pages and which figures, never read
  A's values or even the unit statement (a test asserts it on the request). A figure that read A itself took from an
  image (vision fallback) counts as *correlated*: medium, never auto-posted.
- **Code decides, from a versioned table:** `core/confidence/assess.ts` maps (checks, agreement, flags) to a level and a
  plain-language reason; the route is `auto_post` only if every key figure is high and nothing failed. The LLM never
  decides the route and never reports a number for confidence. `policy@1` is stored with every assessment.
- **Conservative extras:** a footnoted key figure is never auto-posted; an unknown GP or incomplete classification
  goes to triage without paying for read B.

## Consequences
- Proven on the corpus: dev routes match the labels (replayed in CI); the held-out split matched 5 of 5 live; 60+
  injected single-digit misreads were all stopped. Removing signal B lets a 500.0 → 500.1 commitment misread through
  to auto-post, so the second read is load-bearing.
- Cost: one extra vision call per document, about $0.03 and 8–12 s.
- More reviews than strictly necessary are possible (e.g. every chart-only figure). That is the intended trade-off: the
  review queue absorbs uncertainty, and the evals measure straight-through processing before any policy change.
- Changing a threshold or rule changes what is posted without a human, so it requires approval and a new policy version.

## Alternatives considered
- **Model self-reported confidence:** rejected, not calibrated, and not explainable to an auditor.
- **Checks only:** rejected, blind to plausible misreads (the mutation check above).
- **Second read by the same text prompt (self-consistency):** rejected, the errors are correlated; independence comes
  from a different modality.
- **A cheaper model for read B:** deferred to the eval module (SPEC-confidence decision 1).
