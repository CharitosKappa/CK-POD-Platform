# ADR 0026: Persist structured preflight findings instead of a boolean

- Status: Accepted
- Date: 2026-08-29

## Context

Consumers need clear quality guidance and future reviewers need evidence.

## Decision

Persist category, code, severity, affected layer, safe message, and JSON evidence for each prepress finding. Separate deterministic checks from conservative heuristic and future moderation hooks.

## Consequences

Blocking rules are auditable and the UI can remain consumer-friendly without losing internal evidence.
