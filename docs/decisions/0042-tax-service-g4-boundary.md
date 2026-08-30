# ADR 0042: TaxService and G4 boundary

- Status: Accepted
- Date: 2026-08-30

## Context

Tax calculation needs a provider boundary, but nexus and registration decisions are execution gate G4 work.

## Decision

Use `TaxService` with deterministic fake tax by default and optional Stripe Tax integration when configured.

## Consequences

The platform records calculation data without claiming legal compliance or hardcoding US tax policy.
