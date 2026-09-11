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

- Main column: commercial metrics, latest order, unified timeline, and design-credit history when present.
- Side column: customer/contact information, default address, a compact internal-note composer, tags, and design activity.
- The tags input must remain contained by its card at every supported viewport width.
- Notes are submitted from the side card and appear immediately in the timeline after a successful save.
- Preserve existing tag editing behavior.
- Preserve existing loading, empty, feedback, and error states.

## Unified timeline

Build a read-only customer activity stream from existing canonical records rather than duplicating them into a new projection table. Merge and sort the newest 150 customer-related events from:

- customer profile creation and updates;
- marketing-consent changes;
- tag changes and internal notes;
- order placement and every recorded order-state transition;
- refund and reprint activity;
- design-credit ledger entries;
- lifecycle email deliveries.

Each entry includes a concise action title, a detailed description, the actor when known, an exact date and time, and contextual identifiers such as order number, amount, delivery type, or resulting status. Page-originated updates reload the customer payload after success so the new event is visible immediately.

## Edit modals

Replace navigation to the standalone edit page for page-local edits with accessible modal dialogs:

- `Edit customer` in the page header and `Edit` in the Customer card open the same customer modal.
- The customer modal edits first name, last name, email, phone, and email/SMS marketing preferences.
- `Manage` in the Default address card opens a separate address modal containing country, address lines, city, state/province, and postal code.
- Both modals are prefilled from the current customer payload and submit through the existing customer update endpoint.
- Each submission sends the complete customer payload needed to preserve fields managed by the other modal.
- Successful saves close the modal, show page feedback, reload the customer data, and add detailed timeline entries.
- Validation failures remain inside the open modal.
- Dialogs use a labelled modal surface, backdrop, close control, Cancel and Save actions, Escape-to-close, outside-click dismissal, focus placement, and background scroll locking.
- Keep the standalone edit route available as a compatibility fallback, but do not navigate to it from the detail page.

## Visual direction

- Continue the current restrained store-admin palette, typography, card radius, and border system.
- Increase information hierarchy through compact labels, status pills, aligned monetary values, and subtle row dividers.
- Avoid consumer-store decoration and avoid copying Shopify branding.
- Maintain accessible link, button, status, and heading semantics.

## Verification

- Unit-test customer name fallback, relative customer duration, and return-rate calculation.
- Test the customer-detail query mapping for latest-order payment, status, item, quantity, and price data.
- Test unified timeline mapping and ordering across customer, order, refund, credit, and email sources.
- Test modal payload preservation, successful reloads, validation errors, dismissal, and keyboard behavior.
- Run format, lint, typecheck, domain tests, and production build.
- Verify the page, contained tags field, note flow, both modals, and updated timeline in a desktop browser at the current admin viewport and at the responsive single-column breakpoint.

## Out of scope

- Creating orders from the customer page.
- A new event-projection table or event bus.
- A dedicated returns workflow or merchandise-return entity.
- Changing the Customers directory width or layout.
- Redesigning unrelated admin pages.
