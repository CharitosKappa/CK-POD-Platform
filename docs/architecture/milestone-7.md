# Milestone 7 — Review & Fulfillment

Milestone 7 turns a paid platform order into a manually governed fulfillment lifecycle. It preserves the existing canonical `orders.status` state machine; it does not introduce a second fulfillment workflow or change the payment boundary.

## Lifecycle

`PAID → PREPRESS_REVIEW → COMPLIANCE_REVIEW → ROUTING → READY_FOR_PRODUCTION → SUBMITTED_TO_PRINTIFY → IN_PRODUCTION → SHIPPED → DELIVERED`

Trusted operations staff may place an order on hold, reject it into a recoverable exception state, or resume a hold. Every state transition takes an order-row lock, is written to state history, and creates a structured operational audit record. Customer-facing text is derived from canonical state; it is not a separate state machine.

## Review and readiness

The restricted `/ops/reviews` queue and operations API require an authenticated operations role. Prepress and compliance decisions are separately persisted with reason codes and notes. A successful compliance decision triggers final routing; it does not submit fulfillment.

Readiness re-evaluates immutable proof approval, the exact project version/prepress run, a current passed/reviewable prepress run, fresh final routing, current provider qualification (including G3 review and physical test), active provider/variant availability, matching production profile, and a ready private provider derivative. Any failed gate prevents `READY_FOR_PRODUCTION` and is recorded as a named blocker.

## Fulfillment boundary

`OrderOperationsService` owns post-payment transitions, external-order creation, explicit submission, and status reconciliation. Payment and checkout do not import or invoke it. Provider order creation and production submission are separate database-backed idempotent actions; retries and reclaimed stale actions reuse the same idempotency key. Both actions require the canonical `READY_FOR_PRODUCTION` state, and an active action blocks a concurrent operational hold until it completes or fails. A real Printify submission requires `APP_ENV=production`, `FULFILLMENT_ADAPTER=printify`, and `PRINTIFY_PRODUCTION_SUBMISSION_ENABLED=true`; otherwise it fails closed.

Verified webhooks and trusted polling only normalize status evidence. They can advance an order only through the canonical allowed-transition table, and every duplicate, conflict, or unknown update is retained for audit. Consumer clients still receive controlled proof assets only; production masters, provider derivatives, sources, and storage keys remain private.

## Gates

G3 Printify qualification and G6 physical test-print evidence are hard production-readiness gates. G4 tax and G5 legal remain open from checkout. Development uses the deterministic fake fulfillment adapter and may exercise the workflow, but is not production qualified.
