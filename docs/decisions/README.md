# Architecture Decision Records

ADRs document material, implementation-level decisions that shape the modular monolith. They do not supersede the authoritative requirements in `docs/MASTER_BUILD_PROMPT.md`.

The latest locked product-decision record is [ADR 0030: Meeting #004 — Guided Creation and Structured Preset Engine](0030-meeting-004-guided-creation-and-structured-presets.md). It records the supersession of the older flat style-preset requirement and the new Milestone 4.5 boundary.

Milestone 4.5 implementation decisions are recorded in ADRs [0031](0031-versioned-style-catalog.md), [0032](0032-structured-preset-conditioning.md), and [0033](0033-visual-preset-metadata-and-attribution.md).

Milestone 5 fulfillment decisions are recorded in ADRs [0034](0034-platform-owned-fulfillment-adapter.md), [0035](0035-provider-qualification-and-private-derivatives.md), [0036](0036-explainable-platform-routing.md), and [0037](0037-catalog-sync-and-event-reconciliation.md).

Milestone 6 commerce decisions are recorded in ADRs [0038](0038-platform-owned-payment-service.md) through [0046](0046-profiled-server-rendered-consumer-mockups.md). They preserve canonical `PAID` as the payment boundary, prohibit payment-triggered production submission, and require profiled consumer proofs to remain distinct from production assets.

Milestone 7 is recorded in [ADR 0047](0047-order-operations-transition-authority.md). It assigns all post-payment canonical transitions to the platform-owned operations service and keeps provider updates observational until they pass the same state validator.

Milestone 8 is recorded in [ADR 0048](0048-policy-engine-and-final-artwork-gate.md). It keeps
provider classifiers behind platform-owned, versioned policy semantics and makes final-artwork policy
eligibility a prerequisite for M7 production readiness; it does not complete G5.

Milestone 9 is recorded in [ADR 0049](0049-analytics-cx-and-lifecycle-boundaries.md),
[0050](0050-cx-refunds-reprints-and-defects.md), and
[0051](0051-lifecycle-idempotency-and-trigger-semantics.md). It retains platform authority over
metrics, CX side effects, and lifecycle idempotency.

## Statuses

- **Proposed** — under review; not yet used as a project decision.
- **Accepted** — active project decision.
- **Superseded** — replaced by a later ADR.

## Template

```md
# ADR NNNN: Short decision title

- Status: Accepted
- Date: YYYY-MM-DD

## Context

Why this decision is needed and which requirements constrain it.

## Decision

The selected approach.

## Consequences

Benefits, trade-offs, and follow-up work.
```
