# ADR 0029: Run prepress as an idempotent asynchronous lifecycle

- Status: Accepted
- Date: 2026-08-29

## Context

High-resolution rendering and validation must not depend on a browser request remaining open.

## Decision

Persist PENDING runs before queueing, claim once into RENDERING, validate, and end in PASSED, REVIEW_REQUIRED, BLOCKED, or FAILED. Use a version/profile/renderer idempotency key and safe failed-run retry.

## Consequences

Rendering can move to a separate durable worker without changing domain behavior. Stale processing recovery remains operational hardening work.
