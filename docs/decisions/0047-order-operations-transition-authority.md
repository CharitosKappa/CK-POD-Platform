# ADR 0047: One authoritative order-operations transition service

- Status: Accepted
- Date: 2026-08-31

## Context

Milestone 7 begins after the immutable payment boundary. The approved lifecycle requires trusted prepress and compliance review, final routing based on current provider qualification, an explicit production-submission action, and provider status reconciliation. Those paths must not become separate, competing order workflows or let webhooks and retries bypass gates.

## Decision

Use a platform-owned `OrderOperationsService` as the sole post-payment writer of canonical order transitions. It locks the order row before every transition, writes state history plus a structured operational audit, persists review/hold/routing/readiness decisions, and checks the current qualified provider, variant, profile mapping, proof approval, prepress state, and derivative immediately before readiness.

Provider order creation and production submission are separate persisted idempotent actions. A real Printify submit is fail-closed: it requires a trusted operations action, the real adapter, the explicit production flag, and a production environment. Verified provider webhooks and trusted polling are observations; they are normalized and reconciled through the same transition validator rather than setting state directly.

## Consequences

The canonical state machine remains unchanged: payment finishes at `PAID`, then approved review/routing can lead to `READY_FOR_PRODUCTION`, `SUBMITTED_TO_PRINTIFY`, and later lifecycle states. A provider override is auditable but cannot override G3/G6 or other hard eligibility checks. Durable action records permit retry/recovery without repeated external submission. Actual Printify qualification and physical evidence remain external execution gates.
