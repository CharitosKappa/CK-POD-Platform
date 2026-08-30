# ADR 0044: Guest checkout ownership

- Status: Accepted
- Date: 2026-08-30

## Context

Guest checkout is required without weakening existing session isolation.

## Decision

Use the existing secure session ownership pattern for carts and orders, and migrate matching guest records on authentication.

## Consequences

Guests can pay securely; other sessions cannot access their carts, proofs, or orders.
