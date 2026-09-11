# Ecommerce admin foundation — Phase 1

## Objective

Replace the fragmented, operations-oriented admin experience with one ecommerce-first admin
workspace inspired by Shopify's clarity and information hierarchy, without copying Shopify or
introducing its depth. Phase 1 establishes the shared admin foundation and replaces the existing
Home, Orders, and Customers experiences with production-connected pages.

The admin remains an internal staff tool. It is not part of the consumer storefront and does not
expose provider credentials, production assets, provider economics, or internal policy evidence.

## Product direction

The admin treats the store as a commerce business first. Revenue, orders, customers, products,
and issues requiring attention define the primary hierarchy. Review, prepress, routing, and
fulfillment remain available as contextual workflows, but they do not define the visual identity
or navigation model.

The interface uses a quiet neutral palette, compact typography, white content surfaces, subtle
borders, consistent status colors, and dense but readable tables. It is desktop-first and remains
fully functional on tablet and mobile.

## Unified information architecture

The canonical staff workspace lives under `/admin`:

- Home
- Orders
- Products
- Customers
- Analytics
- Design reviews
- Fulfillment
- Settings

Phase 1 activates Home, Orders, and Customers. Later destinations appear only when they have a
functional screen; the shell must not ship dead links. Existing `/ops` routes remain available
until their matching `/admin` replacement is complete, then become redirects to the canonical
page.

The existing staff authentication and role system remains authoritative. The `/admin` layout is
the sole shared shell; `/ops` must not retain a second visual system after migration.

## Shared admin shell

Desktop uses a fixed sidebar and a flexible full-width content area. The sidebar contains the
Let It Be identity, store context, primary commerce navigation, a secondary Operations group,
and Settings at the bottom when it becomes available. Tablet and mobile use a compact header and
an accessible navigation drawer.

Every page uses the same primitives:

- page title, supporting context, and one dominant primary action when required;
- searchable list toolbar with filters and saved views where the backend supports them;
- compact status chips with green success, amber attention, red problem, and neutral grey;
- responsive desktop tables that become structured linked rows on small screens;
- consistent loading, empty, error, retry, success, and mutation-in-progress states;
- progressive disclosure for technical or production-specific details.

## Ecommerce Home

`/admin` is a commerce overview, not an operations queue. It shows server-owned values for total
sales, order count, average order value, conversion when sufficient analytics data exists, and
returning-customer activity. Unknown values are shown as unavailable rather than zero.

A compact `Needs attention` section summarizes orders requiring review, holds, payment or
fulfillment exceptions, and other actionable states. Recent orders and best-selling products sit
below the business overview. Every card links to a real filtered destination; Phase 1 omits cards
whose destination is not yet functional.

## Orders

`/admin/orders` presents an ecommerce order list with search and backend-supported filters for
order, payment, fulfillment, review, date, and customer state. The default columns emphasize
order number, date, customer, items, total, payment status, and fulfillment status.

`/admin/orders/[orderNumber]` starts with the commercial record: items, pricing, customer,
delivery address, billing snapshot, payment, and current order state. Timeline, refunds, review,
fulfillment groups, shipment tracking, and permitted operational actions follow in contextual
sections. Provider IDs, readiness evidence, routing internals, and prepress details live inside a
collapsed `Technical details` region visible only to authorized roles.

Existing trusted order mutations continue to call the established domain services. The redesign
does not bypass review, compliance, qualification, readiness, idempotency, or audit boundaries.

## Customers

`/admin/customers` emphasizes customer name/email, location when available, order count, total
spent, last order, and tags. Search and filters operate against admin read models rather than
client-side copies.

`/admin/customers/[customerId]` presents profile and contact details, commerce summary, order
history, saved addresses, tags, notes, and a human-readable timeline. Existing notes and tag
mutations retain staff authorization and audit attribution. Technical identifiers remain
secondary.

## Data and API boundaries

Admin pages consume dedicated server-owned read models. Financial metrics derive from canonical
orders and payments; operational counts derive from canonical workflow state. Browser code does
not calculate authoritative totals or infer state from analytics events.

The implementation may add focused admin query methods and routes, but it must reuse existing
domain mutation boundaries. Responses include only the data required by the page and must follow
current redaction, ownership, staff-role, and error-handling rules.

## Error handling and accessibility

Read failures produce a concise page-level message and retry action. Empty states explain the
absence of records without looking like an error. Mutations disable only the action in progress,
preserve surrounding context, and surface an accessible success or error result.

The shell and pages require semantic landmarks, visible keyboard focus, labelled controls,
accessible tables or equivalent mobile structures, keyboard-operable navigation/dialogs, and
touch targets suitable for the approved mobile viewport.

## Rollout

Phase 1 is delivered in internal slices:

1. shared shell and navigation;
2. ecommerce Home read model and page;
3. Orders list and detail migration;
4. Customers list and detail migration;
5. legacy-route redirects and removal of duplicated styling only after functional parity.

No existing operational route is removed before its replacement passes parity review. Products,
Analytics, Settings, Design reviews, and Fulfillment consolidation follow as separate approved
phases in that order.

## Verification

- Domain and API tests cover admin read models, filters, role restrictions, and safe errors.
- Existing order and customer mutation tests remain green.
- Route tests confirm unauthenticated and unauthorized access fails safely.
- Format, lint, typecheck, default tests, integration tests, database verification, and builds
  pass.
- Manual browser review covers desktop, tablet, and mobile layouts plus keyboard navigation,
  dialogs, focus return, filters, loading, empty, and error states.

## Acceptance criteria

- Staff use one coherent `/admin` workspace for Home, Orders, and Customers.
- The Home reads as an ecommerce dashboard within five seconds, with operational work presented
  as attention items rather than the page identity.
- Orders and Customers prioritize commercial information while preserving every authorized
  operational capability.
- Replaced `/ops` destinations redirect only after parity is verified.
- No dead navigation, fake production data, exposed secrets, or weakened workflow gate ships.
