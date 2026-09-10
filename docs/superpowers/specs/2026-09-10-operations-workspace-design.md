# Operations workspace — fulfillment flow

## Purpose

Add an internal, authenticated operations workspace for the day-to-day flow from a paid order through review, fulfillment-group readiness, production submission, and shipment tracking. It uses the existing operations APIs and does not activate Printify, payments, email, or AI integrations.

## Scope

This first slice covers the operational workflow only:

- review orders and their current state;
- make the existing review and hold/resume decisions;
- inspect fulfillment groups independently;
- evaluate a group's readiness;
- submit or retry an eligible group; and
- inspect group-level shipment tracking and aggregate order state.

Refunds, reprints, provider-catalog administration, customer-support notes, and analytics stay on their existing pages for later slices.

## Experience

### Desktop

The operations area uses a persistent admin sidebar. The main window changes route by route, rather than splitting the orders list and an order detail into two columns. `/ops/orders` is a compact, filterable operational list. Selecting an order opens its own route, `/ops/orders/:orderNumber`, as a full main-window order page while the sidebar remains fixed.

### Mobile

The same routes use a compact admin header in place of the full sidebar. Selecting an order opens its full-width order page with a back-to-orders control. Controls stay comfortably touch-sized, and the relevant next action remains visible near the bottom without covering the content.

### Queue

The Orders page has saved operational views and compact filters:

- Needs review;
- Ready;
- In production;
- Partially shipped;
- On hold.

Each row/card shows the order number, current status, product/quantity, customer email, and age. On desktop it is a dense table; on mobile it collapses to compact rows. Empty, loading, and failed states use the existing shared feedback styles.

### Order detail

The detail has four ordered sections:

1. **Order summary** — order number, aggregate status, customer, product, quantity, and creation time.
2. **Review** — relevant policy result and only the review/hold/resume controls allowed by the current state.
3. **Fulfillment groups** — one clearly separated panel per group, displaying provider, group status, qualification, item count, readiness evaluation, and externally assigned order ID when present.
4. **Tracking** — group-scoped carrier, service, tracking number/link, and shipment status. The order-level state remains visible as the aggregate of the groups.

Readiness failures remain actionable rather than generic: the UI renders the reason supplied by the API and does not claim a group can be submitted when the backend has not marked it eligible.

## Actions and state

The UI only exposes actions supported by `POST /api/ops/orders/:orderNumber/actions`:

- start or decide review;
- hold or resume an order;
- route where the backend permits it;
- evaluate a fulfillment group;
- submit a fulfillment group; and
- use the existing order-level submission only for compatible legacy/single-group situations.

Every mutation disables its own control while pending, preserves unrelated controls, refreshes the selected order and queue after success, and shows the API's safe message inline after failure. A successful group action refreshes the aggregate order state as well.

## Data and boundaries

The Orders page reads the existing review queue endpoint and the order page reads the existing group endpoint. A small internal read model may be added only if the existing queue response does not contain enough safe order-summary data for the order page. It does not receive private asset storage keys, provider tokens, payment information, or new customer data. Authorization remains server enforced through the existing operations session checks.

## Validation

- Component tests cover queue loading, filter selection, mobile drill-in/back behavior, permitted action rendering, pending/error/success feedback, and group tracking display.
- Existing route and domain integration tests continue to cover authorization and lifecycle transitions.
- Type checks, linting, and the targeted commerce/fulfillment integration suites must pass.
