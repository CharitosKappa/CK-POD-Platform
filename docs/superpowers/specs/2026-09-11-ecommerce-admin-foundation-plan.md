# Ecommerce admin foundation — Phase 1 implementation plan

## 1. Unify the trusted staff actor boundary

- Add a migration that permits canonical order audit records to attribute either a legacy
  operational user or a staff member.
- Introduce a shared order-operations actor type that accepts the current authenticated staff
  session without manufacturing a consumer user.
- Map staff roles explicitly: `OWNER` to full admin, `OPERATIONS` to commerce/fulfillment
  operations, `PREPRESS` to review-only operations, and `READ_ONLY` to safe reads only.
- Preserve all existing order transition, review, readiness, idempotency, and production gates.
- Add integration coverage for staff reads, staff mutations, audit attribution, and read-only
  rejection.

## 2. Add ecommerce-focused admin read models

- Add a focused admin commerce service rather than expanding the already large workflow service.
- Return a Home summary with canonical revenue, orders, AOV, customer activity, attention counts,
  recent orders, and best-selling products.
- Return an order list emphasizing order/date/customer/items/total/payment/fulfillment while still
  supporting the existing operational views.
- Return an order detail with commercial snapshots first and a separately grouped technical and
  fulfillment payload.
- Keep unknown analytics values explicit and keep all calculations server-owned.

## 3. Add canonical `/api/admin` routes

- Add `/api/admin/dashboard`, `/api/admin/orders`, `/api/admin/orders/[orderNumber]`, and staff-safe
  action routes.
- Require the staff cookie for every route and reuse the existing safe route-error mapping.
- Validate filters and action payloads at the HTTP boundary.
- Do not remove `/api/ops` during this phase.

## 4. Build the shared ecommerce admin shell

- Replace the current customer-only sidebar with a single responsive admin shell.
- Add active-route navigation for Home, Orders, and Customers only; later destinations are not
  rendered as dead links.
- Add an accessible mobile drawer, store context, staff identity, and sign-out.
- Introduce a dedicated admin component/style namespace so the old Ops CSS can be retired after
  route parity.

## 5. Build ecommerce Home

- Replace the `/admin` redirect with a commerce dashboard.
- Add period context, KPI cards, Needs attention, recent orders, and best-selling products.
- Make every actionable card link to a real filtered destination.
- Provide loading, empty, error, and retry states.

## 6. Migrate Orders

- Add `/admin/orders` with search, status views, responsive table/rows, totals, payment status, and
  fulfillment status.
- Add `/admin/orders/[orderNumber]` with items and money first, followed by customer, addresses,
  payment, timeline, and permitted actions.
- Place provider, policy, routing, readiness, and fulfillment-group internals inside progressive
  disclosure.
- Preserve focus-safe confirmation dialogs and refresh the canonical record after mutations.

## 7. Redesign Customers

- Keep the existing staff-backed customer APIs and mutations.
- Restyle the list and detail into the new shared page, toolbar, table, summary, and timeline
  patterns.
- Prioritize total spent, order count, last order, contact information, addresses, tags, and notes.
- Update links to canonical `/admin/orders` destinations.

## 8. Redirect only replaced legacy pages

- Redirect `/ops/dashboard` and `/ops/orders` destinations after the matching `/admin` pages pass
  functional parity.
- Keep Providers and Reviews under `/ops` until their later approved migration phases.
- Remove no legacy API in Phase 1.

## 9. Verification

- Apply and verify the new migration.
- Run focused domain/API tests and the full integration suite.
- Run format, lint, typecheck, default tests, and both production builds.
- Exercise sign-in, Home, Orders, order actions, Customers, mobile navigation, responsive tables,
  keyboard focus, dialogs, loading, empty, and error states in a real browser.
