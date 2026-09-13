# Orders Directory Operations Design

**Date:** 2026-09-13  
**Status:** Approved for implementation planning

## Objective

Upgrade the admin Orders directory so its sorting, filtering, selection, and export behavior is consistent with the Customers directory while remaining specific to order operations. Every displayed value and export row must come from the database or an existing order-domain mechanism; the feature must not introduce fixture-only UI state.

## Scope

This work covers the Orders list at `/admin/orders`, the admin Orders list API, order-query domain logic, order-export persistence and processing, and the associated admin UI. It does not change the Order Detail Page, fulfillment transitions, printing transitions, payments, refunds, or customer exports.

## Directory Interaction Model

The current server-rendered directory will become a client-driven admin directory backed by `/api/admin/orders`. The route remains directly addressable and usable after refresh. Shareable state is written to the URL, including search, view, sort, page, and all filters. Page size remains 30.

The existing views remain:

- All
- Open
- In progress
- Completed
- Needs attention
- Cancelled

Changing any search, view, sort, or filter resets the page to 1 and clears the current bulk selection. Query input uses the same short debounce behavior as Customers. Pagination shows the visible range and total count.

## Sorting

The following headers are interactive and expose accessible ascending/descending state:

| Column | Ascending | Descending |
| --- | --- | --- |
| Order | Numeric order sequence, oldest identifier first | Numeric order sequence, newest identifier first |
| Date | Oldest first | Newest first |
| Customer | Name/email A–Z | Name/email Z–A |
| Items | Lowest quantity first | Highest quantity first |
| Payment | Status A–Z | Status Z–A |
| Fulfillment | Status A–Z | Status Z–A |
| Total | Lowest value first | Highest value first |

The default sort is Date descending. Every database ordering includes a stable order-number tie-breaker so pagination cannot reorder equal values between requests.

## Filters

Filters are order-specific and combine with the active view and search using AND semantics:

- Payment status: any or one persisted payment state.
- Printing status: any or one persisted printing state.
- Fulfillment status: any or one persisted fulfillment/order state used by the admin layer.
- Date range: optional inclusive start and end dates interpreted in the admin's configured timezone and converted to database timestamps.
- Total range: optional minimum and maximum USD amount, converted to integer cents before querying.

Invalid status values, malformed dates, negative monetary values, and a minimum greater than a maximum return a clear HTTP 400 response. `Clear filters` removes all five filters but preserves the current view and search. Active filters are visible in the URL.

## Search

Search continues to match order number, customer email, and customer recipient name. It also matches product display name. Search uses parameterized SQL and trimmed input.

## Bulk Selection

Each order row receives a checkbox. The header checkbox selects or clears all orders on the current 30-row page.

Once at least one order is selected, a bulk action bar appears and shows the selected count. When every row on the current page is selected and more matching orders exist, the bar offers `Select all (N)`, where `N` is the total result count after applying the active view, search, and filters.

Selecting all matching orders switches selection to a filter snapshot rather than loading every ID into the browser. Individual rows may then be excluded. The effective count is `matching total - excluded IDs`. `Clear` resets page selection, all-matching selection, and exclusions.

Selection is represented as one of:

```ts
type OrderExportSelection =
  | { type: 'IDS'; orderIds: string[] }
  | {
      type: 'FILTER';
      filters: OrderExportFilters;
      excludedOrderIds?: string[];
    };
```

Order IDs are database UUIDs; order numbers remain display identifiers. The list API therefore returns the internal order UUID in addition to the displayed order number.

## Export Behavior

Two entry points are provided:

- `Export page` exports the orders currently shown on the page.
- `Export selected` exports the effective bulk selection, including an all-matching filter snapshot and any exclusions.

Exports of up to 1,000 orders are generated synchronously and downloaded immediately. Larger exports create a background job. The UI shows queued, processing, ready, failed, and expired states, processing progress, and a download action when ready. A queued export remains available if the admin leaves or refreshes the page.

Ready files expire seven days after completion, matching the Customers export retention model. Export jobs are scoped to the requesting staff member. Read-only staff may view the list but cannot select or export orders.

## CSV Contract

The UTF-8 CSV contains one row per order and uses deterministic ordering from the selection snapshot. Columns are:

1. Order ID (display order number)
2. Created at (ISO 8601 UTC)
3. Customer name
4. Customer email
5. Products
6. Item quantity
7. Payment status
8. Printing status
9. Fulfillment status
10. Total
11. Currency
12. Shipping city
13. Shipping state
14. Shipping country

Multiple product names are joined into the Products cell without creating duplicate order rows. Monetary output is decimal USD derived from stored integer cents. Status values come from persisted order, payment, fulfillment, and printing records rather than UI labels.

## Persistence and Background Processing

A new `app.order_exports` table mirrors the lifecycle guarantees of `app.customer_exports` while storing an order selection snapshot. It records requester, status, counts, storage key, file name, failure reason, queue job ID, timestamps, and expiry.

The domain owns an `OrderExportService` with request, list, resolve, process, download, recovery, and expiry behavior. It uses a dedicated `order-exports` queue and a private storage prefix under `admin/order-exports/`. Both the web development runtime and worker runtime register the consumer. The export query reuses the same validated filter builder as the Orders list, preventing list/export drift.

## API Surface

- `GET /api/admin/orders`: accepts list, sort, search, and filter parameters.
- `POST /api/admin/orders/export`: requests an immediate or queued export.
- `GET /api/admin/order-exports`: returns export jobs for the current staff member.
- `GET /api/admin/order-exports/[exportId]/download`: streams a ready, unexpired CSV owned by the current staff member.

All endpoints require an admin session. Validation failures return 400, access failures return 403, missing exports return 404, and unexpected failures use the existing admin error mapping.

## Reuse and Boundaries

The Orders UI follows the Customers interaction language and may reuse small presentational patterns, but order selection, filters, query types, export persistence, and export services remain order-specific. The existing customer export service is not generalized during this work, avoiding a risky cross-feature refactor.

The shared admin preferences object will store the preferred Orders view and sort. Filter values stay in the URL and are not stored as long-lived preferences.

## Verification

Tests must cover:

- URL-state parsing and round-tripping for every order filter and sort.
- API rejection of malformed page, limit, status, date, and monetary filters.
- Domain query mapping for every sort and filter, including stable pagination.
- Combined view, search, and filter selection.
- Page selection, all-matching selection, exclusions, and effective counts.
- Synchronous CSV generation at or below 1,000 orders.
- Background queueing above 1,000 orders, processing progress, download ownership, expiry, recovery, and failures.
- CSV escaping, multi-product aggregation, integer-cent formatting, and persisted printing/fulfillment/payment values.
- UI accessibility for sortable headers and selection controls.

Final verification includes formatting, lint, typecheck, focused tests, full unit tests, integration tests with PostgreSQL, production build, and browser review of sorting, filtering, page selection, all-result selection, immediate export, and queued-export status.

## Non-goals

- Bulk fulfillment, printing, cancellation, refund, or payment mutations.
- Saved custom order views.
- Customizable Orders columns.
- XLSX or JSON exports.
- Changes to customer export behavior.
