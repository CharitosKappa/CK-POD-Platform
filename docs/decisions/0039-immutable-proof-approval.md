# ADR 0039: Immutable proof approval

- Status: Accepted
- Date: 2026-08-30

## Context

Production approval must never silently apply to changed artwork or a different product/color state.

## Decision

Persist proof approval against a cart item’s project/version, prepress run, controlled mockup, product, and color. Invalidate it when those active project facts diverge.

## Consequences

Checkout requires a new proof approval after relevant design changes while retaining historical approval evidence.
