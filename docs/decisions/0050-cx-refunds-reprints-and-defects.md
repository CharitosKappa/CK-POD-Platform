# ADR 0050: CX monetary and replacement operations

## Status

Accepted for Milestone 9.

## Decision

Refunds reserve a unique pending request while holding the canonical order advisory lock; the payment provider receives the same idempotency key. Refund caps include pending and succeeded amounts. Provider response IDs and both request/outcome audit records are retained.

Reprints are lineage records, not cloned orders or fulfillment actions. Approval is trusted and rechecks the currently selected provider qualification. It does not create an external order, and it cannot bypass M7 compliance, routing, readiness or explicit production submission. Defects use a small operational taxonomy plus provider/product/item/fulfillment/reprint attribution for later analysis.

## Consequences

CX cannot accidentally multiply money movement or production. A provider retry after an ambiguous failure is safe because the provider key is stable. Reprint orchestration remains intentionally separate until it enters the normal M7 controlled path.
