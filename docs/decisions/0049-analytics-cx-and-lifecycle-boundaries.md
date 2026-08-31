# ADR 0049: Analytics, CX and lifecycle boundaries

## Status

Accepted for Milestone 9.

## Decision

Analytics events, CX refunds/reprints and lifecycle intents are platform-owned services. Provider adapters implement payment refunds and lifecycle delivery but cannot become the system of record. Event and delivery idempotency keys make webhook and worker retries non-counting.

## Consequences

Financial reporting derives from immutable commerce snapshots; missing acquisition/direct-cost data is explicitly unavailable. Reprints cannot bypass the M7 production controls. G5 still controls final consent and legal messaging policy.
