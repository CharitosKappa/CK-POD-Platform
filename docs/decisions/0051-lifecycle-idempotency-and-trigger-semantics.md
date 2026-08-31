# ADR 0051: Lifecycle delivery and trigger semantics

## Status

Accepted for Milestone 9.

## Decision

Business code emits lifecycle intents only through `LifecycleMessagingService` and `LifecycleOrchestrator`; Klaviyo is an optional adapter and the deterministic fake adapter is the local/CI default. A persisted delivery key is the idempotency boundary. Transactional messages cover confirmation, shipping and delivery; marketing messages cover welcome, saved project, generated-no-purchase, cart/checkout abandonment, review and reorder/revisit. Purchase suppresses pending marketing abandonment records.

## Consequences

Duplicate webhooks and workers do not create duplicate customer messages. Timing is injected into worker processors rather than embedded in domain transitions. Payloads are minimized to email and necessary order/project identifiers; prompts, source/production assets, policy evidence and provider economics stay out of lifecycle systems.
