# ADR 0043: Payment webhook idempotency

- Status: Accepted
- Date: 2026-08-30

## Context

Payment callbacks, retries, and browser refreshes can recur.

## Decision

Persist checkout idempotency keys, provider payment IDs, and unique provider event IDs. The verified webhook is authoritative for settlement.

## Consequences

Duplicate payment events cannot create duplicate platform orders for one checkout/cart.
