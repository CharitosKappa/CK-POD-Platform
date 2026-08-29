# ADR 0034: Keep Printify behind a platform-owned fulfillment adapter

- Status: Accepted
- Date: 2026-08-30

## Context

Milestone 5 needs Printify catalog, shipping, and future order capabilities without making its response structures or order-routing behavior canonical platform behavior.

## Decision

`FulfillmentService` is the platform-owned contract for catalog synchronization, normalized shipping quotes, idempotency-keyed future order operations, status lookup, and webhook verification. `PrintifyFulfillmentAdapter` is a server-only implementation. Local development and CI use `FakePrintifyFulfillmentAdapter` by default.

Real Printify mode is opt-in through `FULFILLMENT_ADAPTER=printify`, `PRINTIFY_API_TOKEN`, and `PRINTIFY_SHOP_ID`. Credentials never enter browser responses. The fake adapter rejects production submission deliberately. No consumer, payment, or checkout path invokes order creation or production submission in Milestone 5.

## Consequences

The platform can replace or add fulfillment adapters without rewriting routing or catalog logic. Real endpoint behavior still needs credentialed validation and operational monitoring. Printify Order Routing is neither invoked nor authoritative; a disabled-by-default configuration field records this policy for future work.
