# ADR 0004: Abstract jobs behind a BullMQ-compatible queue contract

- Status: Accepted
- Date: 2026-08-29

## Context

Generation, prepress, fulfillment synchronization, and notifications require durable asynchronous execution, retries, and idempotency. External work must not run in a browser request path.

## Decision

Define `BackgroundJobQueue` as the internal job contract. Provide BullMQ/Redis for durable production execution and an in-memory implementation for local development and tests.

## Consequences

Domain modules depend on the contract, not BullMQ. The Foundation includes no domain consumers or jobs; later milestones define queue names, payload schemas, retry policies, and operation persistence in their own modules.
