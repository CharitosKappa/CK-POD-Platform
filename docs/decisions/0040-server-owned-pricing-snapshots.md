# ADR 0040: Server-owned pricing snapshots

- Status: Accepted
- Date: 2026-08-30

## Context

Browser totals and mutable provider economics cannot authorize a charge.

## Decision

Compute USD integer-cent retail, discount, customer shipping, tax, and total server-side; persist them with configuration version and separate provider shipping cost.

## Consequences

Historical order explanations do not depend on future catalog or routing changes.
