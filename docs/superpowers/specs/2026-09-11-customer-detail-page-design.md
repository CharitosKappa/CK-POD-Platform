# Customer Detail Page Design

## Goal

Redesign the admin customer detail page as a focused ecommerce workspace inspired by Shopify. The page should prioritize customer identity, commercial history, the latest order, and staff context without using the full width available to the Customers directory.

## Page frame

- Keep the existing admin shell and sidebar.
- Constrain the customer detail content to a centered maximum width of approximately 1,120 pixels.
- Use a two-column desktop layout: a wider primary column for commercial activity and a narrower secondary column for profile information.
- Collapse to one column on smaller viewports while keeping the commercial summary and latest order first.

## Identity header

- Display the customer's trimmed first and last name when either value exists.
- Fall back to the normalized email address when no name exists.
- Keep the customer avatar initials and the existing Edit customer action.
- Display `Customer since <date> (<relative duration>)`, for example `Customer since Mar 11, 2026 (6 months)`.
- Append the saved location when available.
- Relative durations use the largest useful unit: days for less than one month, months for less than one year, and years thereafter.

## Commercial metrics

Present five metrics in one card:

1. Amount spent
2. Orders
3. Average order
4. Credits
5. Return rate

`Return rate` is the percentage of qualifying orders that have at least one successful refund. Qualifying orders use the same rule as customer segmentation and exclude `DRAFT`, `PAYMENT_PENDING`, `CANCELLED`, and `FAILED`. An order with multiple successful refund records counts once. Customers without qualifying orders have a return rate of 0%.

## Latest order card

Replace the compact order list with a Shopify-inspired `Last order placed` card:

- Card header: section title and `View all orders` link.
- Order header: order number, payment badge, fulfillment/status badge, total, and order date/time.
- Product rows: variant thumbnail, product name, color and size, quantity, and line total.
- Product rows link to the order detail page through their containing order card.
- Use the product variant image when one exists and a restrained fallback tile otherwise.
- Show only the latest order in expanded form. The existing `View all orders` route remains the entry point for full history.
- Do not add an inactive `Create order` control.

The backend customer-detail response will include the latest order's payment state and item snapshots required by this presentation. Historical order summaries may remain available in the response for future use, but are not rendered as a six-row list in this iteration.

## Supporting cards

- Main column: commercial metrics, latest order, timeline, and design-credit history when present.
- Side column: customer/contact information, default address, tags, and design activity.
- Preserve existing note and tag editing behavior.
- Preserve existing loading, empty, feedback, and error states.

## Visual direction

- Continue the current restrained store-admin palette, typography, card radius, and border system.
- Increase information hierarchy through compact labels, status pills, aligned monetary values, and subtle row dividers.
- Avoid consumer-store decoration and avoid copying Shopify branding.
- Maintain accessible link, button, status, and heading semantics.

## Verification

- Unit-test customer name fallback, relative customer duration, and return-rate calculation.
- Test the customer-detail query mapping for latest-order payment, status, item, quantity, and price data.
- Run format, lint, typecheck, domain tests, and production build.
- Verify the page in a desktop browser at the current admin viewport and at the responsive single-column breakpoint.

## Out of scope

- Creating orders from the customer page.
- A dedicated returns workflow or merchandise-return entity.
- Changing the Customers directory width or layout.
- Redesigning unrelated admin pages.
