# Shopify-like Order Detail and Printing Operations Design

**Date:** 2026-09-13
**Status:** Approved design direction; implementation pending written-spec review

## Goal

Replace the current technical-oriented Order Detail Page with a commerce-first, Shopify-like admin experience. Every displayed value must come from a durable database record, a provider response, or a deterministic server-side projection. The interface must not contain operationally meaningful hardcoded values.

The page introduces three independent status layers:

- **Payment** describes collection and refund state.
- **Printing** describes artwork readiness and production at one or more printer providers.
- **Fulfillment** describes shipment and delivery.

Each layer owns its state and history. A state in one layer never doubles as the state of another layer. Cross-layer guards may allow or block an action—for example, production submission requires successful payment—but a guard does not mutate an unrelated layer.

## Page structure

The desktop page uses the same centered, readable admin-detail width as Customer Detail rather than the full-width directory layout. It follows a two-column Shopify-like composition.

The header contains:

- back navigation to Orders;
- order number;
- creation date, time, and sales channel from the order record;
- one compact current-state badge for Payment;
- one compact aggregated current-state badge for Printing;
- one compact aggregated current-state badge for Fulfillment; and
- a contextual actions menu containing only actions valid for the current data and staff role.

The main column contains, in order:

1. fulfillment/item groups with actual purchased items;
2. one compact clickable printing summary per printer-provider group;
3. the financial/payment summary; and
4. a unified order timeline.

The right sidebar contains persisted order notes, linked customer/contact information, immutable order shipping and billing snapshots, and persisted order tags.

Pickup-point blocks, metafields, extensible app blocks, and order-risk UI are excluded. Conversion summary is also excluded until the store has an approved attribution model; no synthetic attribution copy will be shown.

## Order items and fulfillment presentation

Purchased items are grouped by their fulfillment group. Each item displays only persisted order-time data:

- controlled mockup thumbnail;
- product title;
- color and size;
- quantity;
- unit price and line total;
- order-item identifier or SKU when available; and
- associated immutable design/project version.

The customer-facing product and price snapshots remain authoritative even if the catalog changes later. Admin thumbnails use an authenticated controlled-preview route; private production masters and storage keys are never exposed.

Each fulfillment group shows its current fulfillment state, shipping method snapshot, shipment rows, carrier, service, tracking number/link, and delivery timestamps when present. Multiple providers or shipments remain separate groups. The header fulfillment badge is a deterministic aggregate of those groups and shipments.

## Hybrid printing experience

The Order Detail Page keeps printing compact. Each provider group is represented by a fully clickable summary card with proper button semantics, keyboard focus, and a chevron. It shows only:

- printer-provider display name;
- current printing state;
- external provider order ID, when created;
- number of associated items;
- tracking summary, when available; and
- a visible attention indicator for a failed, stale, rejected, or blocked group.

Activating the summary opens a modal over the existing page. Closing with the close button, Escape, or backdrop returns the admin to the same scroll position.

The modal contains the operations-ready detail:

- provider and external order identifiers;
- submitted time, last synchronization time, and provider-derived estimates when available;
- exact order items and production assets belonging to the group;
- prepress review, compliance review, proof, provider derivative, product/variant mapping, and qualification readiness;
- current production state and any normalized provider failure;
- production cost, provider shipping cost, gross margin amount, and gross margin percentage;
- shipments and tracking;
- relevant provider status/audit events; and
- only the currently permitted exception actions.

Dates or estimates unavailable from a durable source render as an em dash or “Not available”; the UI never invents estimates.

## Independent state model

### Payment

Payment state is projected from `payments` and `order_refunds`, not from `orders.status`. The initial supported aggregate states are:

- `PENDING`
- `PAID`
- `PARTIALLY_REFUNDED`
- `REFUNDED`
- `FAILED`
- `CANCELLED`

The payment block uses immutable checkout/order pricing snapshots for subtotal, discounts, customer shipping, taxes, total, and currency. It uses payment and refund ledgers for paid and refunded amounts. No raw payment credentials are stored or displayed.

### Printing

Printing state is owned per provider fulfillment group. The current mixed `order_fulfillment_groups.status` model will be separated so printing does not become fulfilled merely because a shipment exists. The supported group states are:

- `NOT_STARTED`
- `PREPRESS_REVIEW`
- `COMPLIANCE_REVIEW`
- `READY_FOR_PRODUCTION`
- `SUBMITTING`
- `SUBMITTED`
- `IN_PRODUCTION`
- `PRINTED`
- `ON_HOLD`
- `FAILED`
- `CANCELLED`

An order-level printing state is a deterministic aggregation of its provider groups. Partial and mixed outcomes produce explicit aggregate labels such as `PARTIALLY_IN_PRODUCTION` or `NEEDS_ATTENTION`; they never overwrite payment or fulfillment state.

Existing reviews, readiness evaluations, routing decisions, provider derivatives, fulfillment actions, external order records, normalized webhook/polling events, and operational audits remain the underlying evidence. A dedicated printing-state history records normalized transitions without discarding raw provider event evidence.

### Fulfillment

Fulfillment state is derived from group item quantities and shipment/delivery evidence rather than printing state. The aggregate states are:

- `UNFULFILLED`
- `PARTIALLY_FULFILLED`
- `FULFILLED`
- `DELIVERED`
- `CANCELLED`

The fulfillment projection must account for split shipments and multiple providers. `PRINTED` with `UNFULFILLED`, and `REFUNDED` with `IN_PRODUCTION`, are valid combinations.

The legacy mixed `orders.status` remains temporarily for migration compatibility but is no longer the display authority for Payment, Printing, or Fulfillment. Operational services will write the dedicated layer records first; compatibility projection can be removed only in a later migration after all consumers are converted.

## Database migration and backfill

`order_fulfillment_groups` gains separate constrained `printing_status` and `fulfillment_status` fields. New normalized printing transitions are appended to a dedicated group-scoped printing-event table. Existing shipment rows remain the evidence for fulfillment; normalized fulfillment transitions are recorded without replacing carrier/provider evidence.

The migration backfills every existing group deterministically:

- `PENDING` becomes Printing `NOT_STARTED` and Fulfillment `UNFULFILLED`;
- `ON_HOLD` becomes Printing `ON_HOLD` and Fulfillment `UNFULFILLED` unless shipment evidence says otherwise;
- `READY_FOR_PRODUCTION` becomes Printing `READY_FOR_PRODUCTION`;
- `SUBMITTED` becomes Printing `SUBMITTED`;
- `IN_PRODUCTION` becomes Printing `IN_PRODUCTION`;
- `SHIPPED` becomes Printing `PRINTED` and fulfillment is calculated from shipment quantities;
- `DELIVERED` becomes Printing `PRINTED` and Fulfillment `DELIVERED` only when delivery evidence exists;
- `FAILED` becomes Printing `FAILED` while fulfillment remains evidence-derived; and
- `CANCELLED` becomes Printing `CANCELLED`, with Fulfillment `CANCELLED` only for unshipped quantities.

Where legacy shipment data lacks item quantities, the backfill uses fulfillment-group membership and the strongest durable shipment evidence, records the inference in migration metadata, and never marks an order delivered without a delivery timestamp or normalized delivery event.

The migration also adds persisted order notes, order tags and their relationships, group production-economics snapshots, last provider synchronization timestamps, and the indexes required by order detail and timeline reads. Economics are frozen when routing becomes final or, for existing orders, backfilled only when a historical cost snapshot exists. Missing historical costs remain unknown rather than using today’s catalog cost.

## Production economics

The printing modal displays server-calculated internal economics for authorized staff:

- frozen retail revenue attributable to the group;
- current order-time production cost snapshot;
- provider shipping cost snapshot;
- provider fees, where applicable;
- gross margin amount; and
- gross margin percentage.

Calculations use integer USD cents and immutable order/provider snapshots. Current catalog costs must not retroactively change a historical order. Missing cost evidence renders as unavailable and prevents a misleading margin calculation.

## Actions and provider automation

The normal path is automation-first:

`Ready → Submitted → In production → Printed`, followed independently by shipment and delivery events.

Verified provider webhooks are authoritative when available. Safe polling reconciles stale groups. Both paths deduplicate external events and record their source, raw provider status, normalized status, disposition, and receipt time.

Admin actions are exception-driven:

- retry a failed or stale submission;
- hold or resume;
- cancel when provider and state permit it;
- reroute before external submission;
- reconcile a provider status manually;
- initiate or approve reprint; and
- initiate refund through the payment/refund mechanism.

Every mutation is server-authorized, state-validated, idempotent where external side effects are possible, and recorded with staff actor, reason, timestamp, before/after state, result, and failure detail. Manual reconciliation requires a reason and cannot delete or rewrite provider evidence.

## Notes, tags, customer, and addresses

Order notes and order tags gain dedicated persisted records and admin APIs; they are not borrowed from customer notes/tags. Note and tag mutations create timeline entries.

Customer data links to the real customer profile when one exists and otherwise falls back to the immutable order email/name snapshot. Customer order count is queried from orders rather than displayed as static text.

Shipping and billing addresses always render from immutable order snapshots, not the customer’s current default address. The page clearly states when billing matched shipping at checkout.

## Unified timeline

The timeline is a server-side chronological projection over real events, including:

- order creation and order lifecycle actions;
- payment and refund outcomes;
- printing reviews, routing, readiness, submission, provider updates, holds, cancellations, failures, and reprints;
- shipment and delivery events;
- staff notes and tag changes; and
- transactional notification delivery when it can be associated with the order.

Entries are grouped by calendar date, newest first, and paginated internally at 10 entries per page. Each entry carries a stable event ID/type, timestamp, source, actor when applicable, readable description, and structured metadata for optional expansion. Raw provider payloads and security-sensitive metadata are never emitted to the browser.

## API and component boundaries

`AdminCommerceService` will return a typed commerce projection containing header, items, customer snapshots, addresses, and financial summary. A dedicated order-operations read service will return printing summaries and fulfillment state. A timeline projection service will merge durable events with cursor-based pagination.

The route boundary returns one explicit typed Order Detail DTO rather than merging two overlapping untyped objects. Printing-modal detail is loaded from a group-scoped endpoint only when opened, keeping the initial page fast and preventing unrelated provider data from leaking across groups.

The UI is split into focused components:

- order header and status badges;
- fulfillment group and item rows;
- printing summary trigger;
- printing operations modal;
- payment summary;
- order sidebar sections; and
- order timeline.

## Loading, empty, and error behavior

- The page shows structured loading states rather than a blank screen.
- A missing order produces a real not-found state.
- A printing-modal failure stays inside the modal with retry and does not remove the underlying ODP.
- Provider status staleness is based on a configured server threshold and persisted last-sync time.
- Missing optional data uses an em dash or explicit unavailable label.
- Failed actions preserve the modal state, show the server error, and remain safe to retry when the action contract permits it.
- Read-only roles can inspect permitted data but do not receive mutation controls.

## Verification

Automated tests will cover:

- independent payment, printing, and fulfillment projections, including valid mixed states;
- multi-provider and split-shipment aggregation;
- historical pricing/cost snapshot calculations and unavailable-cost behavior;
- provider-event deduplication and stale-state detection;
- role and state guards for every action;
- idempotent retry behavior;
- group-scoped modal data isolation;
- item, customer, address, notes, tags, and timeline persistence;
- timeline ordering, grouping, pagination, and actor attribution;
- controlled asset authorization; and
- accessible modal and summary-trigger behavior.

Verification before completion includes migration validation, format, lint, typecheck, unit tests, PostgreSQL integration tests, production build, and desktop browser interaction testing of the Orders list and Order Detail Page. Physical mobile verification is not required for this desktop-first admin phase and must not be claimed unless actually performed.
