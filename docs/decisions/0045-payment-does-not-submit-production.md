# ADR 0045: Payment stops at canonical PAID

- Status: Accepted
- Date: 2026-08-30

## Context

Payment success must not bypass manual review, compliance, routing, or production safety gates.

## Decision

Verified payment creates/updates only a platform order in canonical `PAID` state. Commerce contains no fulfillment order-creation or production-submission call path.

## Consequences

Milestone 7 explicitly owns subsequent state transitions and fulfillment submission.
