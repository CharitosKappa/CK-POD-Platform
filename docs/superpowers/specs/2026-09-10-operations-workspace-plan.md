# Operations workspace — implementation plan

## Slice boundary

Build the authenticated admin shell, Orders list, and individual order page for review, fulfillment-group readiness/submission, and tracking. Do not add provider, payment, email, or AI integrations.

## 1. Safe operations read models

- Extend `OrderOperationsService` with an operations-only order detail read model.
- Return only the order summary, existing policy/review data, fulfillment groups, readiness result, and shipment tracking needed by the panel.
- Extend the list query to support the operational views: needs review, ready, in production, partially shipped, and on hold.
- Preserve existing role checks and do not reuse the customer order route for staff access.

## 2. Operations API routes

- Add `GET /api/ops/orders/:orderNumber` for the staff order page.
- Continue using the existing group route and action route; do not duplicate action logic.
- Keep API error responses consistent with existing safe route handling.

## 3. Responsive admin shell

- Add a shared `/ops` layout with a fixed desktop sidebar, compact mobile header, and main content outlet.
- Keep existing operations routes reachable during the transition.
- Use the admin visual language approved in the mockup: quiet neutral surfaces, dense information, compact controls, table-first lists, and clear status chips.

## 4. Orders list page

- Add `/ops/orders` as the primary operational list.
- Render desktop orders as a dense, accessible table and mobile orders as compact linked rows.
- Add static operational views backed by query state; only show filters the backend can actually honor.
- Link every row to `/ops/orders/:orderNumber`.

## 5. Order page

- Add `/ops/orders/:orderNumber` with breadcrumb/back navigation, order summary, review state, fulfillment-group panels, tracking, and permitted actions.
- Disable only the action in flight; refresh order state after a successful mutation.
- Show safe inline success/error feedback.

## 6. Verification

- Add route/domain coverage for staff detail data and state filters.
- Add focused component coverage for list and order-page actions where practical.
- Run type checks, linting, database migration verification, and targeted commerce/fulfillment tests.
