# ADR 0027: Implement the locked printability score as separate from blockers

- Status: Accepted
- Date: 2026-08-29

## Context

The specification locks score weights and bands but says a high score cannot bypass an unsafe design.

## Decision

Calculate the seven locked components to a total of 100 and derive GREEN/AMBER/RED bands. Persist warnings and blockers separately; any BLOCKER makes the result `BLOCKED`.

## Consequences

The score supports guidance and review triage without weakening hard production safeguards.
