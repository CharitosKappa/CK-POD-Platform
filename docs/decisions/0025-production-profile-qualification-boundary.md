# ADR 0025: Keep development production profiles explicitly unqualified

- Status: Accepted
- Date: 2026-08-29

## Context

Milestone 4 needs DTG dimensions and thresholds before provider qualification exists.

## Decision

Store profiles by product, optional provider, decoration method, qualification state, and profile payload. Seed only an `UNQUALIFIED / DEVELOPMENT` DTG profile.

## Consequences

Milestone 5/G3 can qualify provider combinations without changing project semantics. No development values are treated as a Printify production guarantee.
