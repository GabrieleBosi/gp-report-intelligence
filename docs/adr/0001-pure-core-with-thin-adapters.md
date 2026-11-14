# ADR-0001: Pure `core/` with thin Netlify adapters

Status: Accepted · 2026-10-10

## Context
The pipeline's value is in its rules: the financial checks, the confidence routing and the guardrails. Those rules must be
tested exhaustively and cheaply, in CI and without network access, and must outlive the hosting choice.

## Decision
All domain logic lives in `core/` as plain TypeScript with no imports from Netlify, React or Supabase. Dependencies
(clients, env, clock) are passed in as arguments. `netlify/functions/*` only translate HTTP ↔ `core/` calls,
and `netlify/lib/*` holds the concrete clients.

## Consequences
- `core/` is unit-tested with in-memory fakes; coverage on `core/` is gated at 90%.
- Moving off Netlify (e.g. to a container on the bank's platform) rewrites only the adapters.
- Small cost: some plumbing to pass dependencies explicitly.
