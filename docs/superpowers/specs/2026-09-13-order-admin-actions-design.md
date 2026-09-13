# Order Admin Actions Design

**Date:** 2026-09-13  
**Status:** Approved for implementation planning

## Objective

Add Shopify-like operational actions to the Order Detail Page while preserving the platform's independent Payment, Printing, Fulfillment, Return, and Refund layers. Every action must use persisted data, an authoritative domain mechanism, server-side eligibility checks, staff authorization, audit history, and idempotent mutation boundaries. No action may exist only as hardcoded UI behavior.

## Scope

This design covers:

- a context-aware `More actions` menu on the Order Detail Page;
- Edit order;
- Cancel order;
- Refund;
- Return;
- Archive and Unarchive;
- action eligibility, persistence, APIs, modals, audit events, and timeline integration.

The actions operate independently where their business meanings differ. Payment and Refund do not derive from Fulfillment or Return. Printing remains separate from Fulfillment. Archive is organizational metadata rather than an order lifecycle state.

## Interaction Model

The Order Detail Page exposes one `More actions` menu near the order heading and state badges. The menu contains only actions the current staff member may perform and that are eligible for the latest persisted order state. Refund and Return may additionally expose small contextual entry points within their relevant payment or fulfillment surfaces, but both entry points open the same authoritative modal and invoke the same API.

Each action opens a focused modal. The modal loads current eligibility and relevant balances from the server. On submission, the server locks the affected order, recomputes eligibility, validates the idempotency key, and either commits the complete operation or returns a specific failure. Successful actions refresh the Order Detail Page data without navigating away. A failure keeps the modal open and does not present an optimistic state.

## Action Eligibility

### Edit order

Edit is available to authorized staff, but the editable fields depend on production progress:

- Before production submission, staff may edit items, quantities, variants, discounts, shipping charges, customer contact details, and the shipping address.
- Once Printing reaches `IN_PRODUCTION` or `PRINTED`, production-affecting item, quantity, variant, discount, price, and shipping changes are locked.
- After production begins, only safe administrative metadata such as contact details, notes, and tags remains editable.
- Once Fulfillment has shipped, the delivery address is locked.

The server, not the browser, owns this field-level eligibility matrix.

### Cancel order

Cancel is available only while the order is unfulfilled and Printing has not reached `IN_PRODUCTION` or `PRINTED`. A fulfilled order does not expose Cancel. If the order was submitted to a provider but production has not started, cancellation must first succeed at the provider boundary before the canonical order is cancelled. A provider rejection or uncertain response leaves the order active and records the failed attempt.

For a multi-provider order, cancellation is tracked independently for every fulfillment group. The canonical order becomes cancelled only after every required provider cancellation succeeds. If one group cancels and another fails or remains uncertain, the cancellation operation becomes `PARTIAL`, the order moves to operational hold/needs-attention, and staff receives a retry path for only the unresolved groups. Already-cancelled groups are never submitted again.

Cancel does not automatically imply Refund. The modal offers:

- refund to the original payment method;
- refund to Store Credit;
- refund later.

The selected refund operation is executed through its own monetary mechanism as part of the confirmed cancellation orchestration. Cancellation never creates or updates inventory because the store has no owned inventory location; catalog availability continues to come from printing-provider synchronization. The modal therefore has no `Restock inventory` control.

The modal also captures a cancellation reason, an optional staff note, and whether a customer notification should be created.

### Refund

Refund is available whenever an order has a successful payment and a positive refundable balance. It is independent of Fulfillment and Return. Staff may refund without receiving a return, and a return does not automatically issue a refund.

The modal supports:

- item quantities as an amount-calculation aid;
- optional shipping refund;
- a custom adjustment within the remaining refundable balance;
- original payment method or Store Credit destination;
- reason and staff note;
- a final confirmation before money movement.

Original-method refunds use the existing idempotent provider-refund mechanism and `app.order_refunds` ledger. Store Credit refunds create a real customer Store Credit ledger entry. Pending and successful refund amounts count toward the refundable cap so concurrent requests cannot over-refund an order.

### Return

Return is a logistics layer independent of Refund. It is available only for fulfilled or delivered quantities that remain returnable. Staff selects the order items, quantities, reason, shipping requirement, and an optional note.

Return states are:

- `REQUESTED`;
- `APPROVED`;
- `IN_TRANSIT`;
- `RECEIVED`;
- `CLOSED`;
- `REJECTED`.

The sum of active or completed return quantities for an item cannot exceed its fulfilled quantity. Creating or advancing a Return never moves money, creates Store Credit, or initiates a replacement. Those remain explicit independent operations.

### Archive and Unarchive

Archive is available only after an order is fulfilled/delivered or cancelled. It records `archived_at` and the responsible staff member. It does not change Payment, Printing, Fulfillment, Refund, or Return state. An archived order exposes Unarchive, which clears the active archive marker while retaining its audit history.

## Persistence

### Cancellation

Persist an idempotent cancellation operation with:

- order and staff identifiers;
- request idempotency key;
- reason and note;
- notification preference;
- requested refund destination and amount;
- provider-cancellation result when an external provider order exists;
- status, failure reason, and timestamps.

Canonical order cancellation remains an authoritative order transition and occurs only after all required external cancellation gates succeed.

### Returns

Add an `order_returns` aggregate and `order_return_items` rows. The aggregate stores order, state, reason, shipping requirement, note, staff actor, and timestamps. Item rows store order-item identity and quantity. Append-only return events record every state change.

### Archive

Add nullable archive metadata to the order and append archive/unarchive audit events. Archive is never represented by the canonical order status.

### Edits

Persist an order revision for every edit with the staff actor, idempotency key, reason, before snapshot, after snapshot, price difference, and timestamp. Existing immutable fulfillment and payment records are not rewritten. The current commercial order snapshot is updated transactionally only after validation.

If an edit decreases the total, the difference becomes refundable but no refund is issued automatically. If it increases the total, the difference becomes amount due and places production on hold until payment succeeds.

## Domain Boundaries

An `OrderAdminActionsService` coordinates the new actions while delegating existing responsibilities:

- canonical post-payment transitions remain owned by `OrderOperationsService`;
- original-method refunds reuse the existing payment refund mechanism;
- Store Credit adjustments reuse the customer Store Credit ledger;
- provider cancellation uses the configured fulfillment adapter;
- Order Detail read models aggregate action eligibility, archive metadata, return summaries, refund balances, and edit balances.

The service uses database transactions and row/advisory locks to prevent conflicting staff actions. Every mutation requires an idempotency key. The API accepts display order numbers only at the route boundary and resolves them to internal UUIDs before mutation.

## Payment Differences From Editing

An edit that reduces the total records a refundable difference. Staff may later issue a Refund for that balance.

An edit that increases the total records an amount due. The order cannot enter or continue into production until that amount is paid. Collection uses the payment layer rather than mutating an existing successful payment. The Order Detail Page displays the outstanding amount and the operational hold explicitly.

## Notifications

`Notify customer` creates a persisted transactional-notification event describing the action and the customer's stored notification language. Production delivery will use the configured email adapter. In local development, the event is persisted and auditable without sending a real email. Notification delivery is asynchronous after the business action commits; delivery failure does not roll back the action and is recorded in its own timeline event.

## Authorization and Safety

- Owners and Operations staff may perform eligible actions.
- Read-only staff may see state and history but cannot open mutation modals or call mutation endpoints.
- The server recomputes eligibility during submission; client-provided eligibility is never trusted.
- Monetary values use integer minor units and the order's persisted currency.
- Refund and Store Credit amounts cannot exceed the remaining refundable balance.
- Provider cancellation uncertainty is fail-closed.
- Partial multi-provider cancellation places the order on operational hold and never reports whole-order cancellation.
- Every action records the staff actor, source, reason, idempotency key, before/after state, and result.

## API Surface

The Order Detail response includes the current action and field-level eligibility. Mutations use separate resource routes so each contract remains focused:

- `POST /api/admin/orders/[orderNumber]/edits`;
- `POST /api/admin/orders/[orderNumber]/cancellations`;
- `POST /api/admin/orders/[orderNumber]/refunds`;
- `POST /api/admin/orders/[orderNumber]/returns`;
- `POST /api/admin/orders/[orderNumber]/returns/[returnId]/transitions`;
- `POST /api/admin/orders/[orderNumber]/archive`;
- `DELETE /api/admin/orders/[orderNumber]/archive`.

Validation failures return 400, ineligible or conflicting current states return 409, unauthorized roles return 403, missing orders return 404, and provider failures use a typed non-success response without changing canonical state.

## Timeline and Read Model

The Order Detail timeline receives detailed entries for:

- edit fields and monetary difference;
- cancellation request, provider result, canonical cancellation, and chosen refund behavior;
- refund request, destination, amount, and result;
- return creation and every return state transition;
- archive and unarchive;
- notification queued and, when a delivery adapter runs, sent or failed.

Entries include timestamp, staff actor, affected items or amounts, reason, and links to the relevant action identifier. Timeline pagination and date grouping continue to use the existing ten-entry mechanism.

## Error Handling

- A stale modal receives a 409 response with refreshed eligibility details.
- Provider cancellation failure leaves the order active and records the attempt; partial multi-provider success places it on operational hold.
- Refund failure leaves paid/refunded balances unchanged and records the failed request.
- Store Credit issuance and its ledger entry commit atomically.
- Return quantity conflicts fail without partially creating return rows.
- Edit validation or payment-difference calculation failure leaves the order snapshot unchanged.
- Duplicate idempotency keys return the existing operation result rather than repeating side effects.

## Implementation Sequence

1. Shared eligibility engine and `More actions` menu.
2. Archive and Unarchive persistence and modal.
3. Cancel operation and modal without inventory controls.
4. Refund operation and modal for original payment and Store Credit.
5. Independent Return aggregate, transitions, and modal.
6. Edit-order revisions, locks, pricing differences, and modal.
7. Order Detail read-model and timeline integration.
8. Full automated and browser verification.

## Verification

Automated coverage must include:

- the complete eligibility matrix across Payment, Printing, Fulfillment, Return, Refund, and Archive states;
- field-level edit restrictions before and after production and shipment;
- provider cancellation success, rejection, timeout/uncertainty, and idempotent retry;
- cancel with original-method refund, Store Credit, and refund-later choices;
- partial/full refunds, concurrent refund caps, provider failure, and Store Credit atomicity;
- return quantity limits and every return transition without implicit money movement;
- archive/unarchive without lifecycle state changes;
- positive and negative edit price differences and production hold behavior;
- authorization, stale-state conflicts, duplicate idempotency keys, audit events, notification events, and timeline mapping;
- modal visibility, disabled states, validation, success refresh, and error retention.

The final gate is formatting, lint, typecheck, unit tests, PostgreSQL integration tests, production build, and browser verification of every eligible and ineligible action state. Real payment-provider or printing-provider outcomes must be reported separately from local/fake adapter verification.

## Non-goals

- Store-owned inventory or restocking.
- Automatic Refund from Return or automatic Return from Refund.
- Automatic replacement/reprint from Return.
- Editing production artwork after provider production begins.
- Treating Archive as an order lifecycle state.
- Claiming real provider cancellation, refund, or email delivery when only local adapters were exercised.
