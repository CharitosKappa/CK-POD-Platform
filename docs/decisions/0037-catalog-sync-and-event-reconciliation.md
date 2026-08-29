# ADR 0037: Persist allowlisted catalog syncs and normalized fulfillment events

- Status: Accepted
- Date: 2026-08-30

## Context

External catalog data changes independently of local qualification decisions. Pages cannot depend on live Printify availability, and webhook delivery may duplicate or fail.

## Decision

Catalog synchronization fetches only locally allowlisted blueprint mappings, persists observed provider and variant availability, and records bounded retry attempts. Missing external data is marked unavailable rather than deleted, preserving historical mappings and local qualification configuration. Manual trusted-Ops refresh is available; scheduled orchestration can reuse the same idempotent service later.

Webhook events are HMAC-verified when a secret is configured, normalized before persistence, and deduplicated by adapter/external event identifier. M5 records event infrastructure only; it does not apply a Milestone 7 order lifecycle.

## Consequences

The system can reconcile provider/catalog drift safely without treating a sync as qualification approval. Real Printify webhook header and event schema validation remains a credentialed operational verification item.
