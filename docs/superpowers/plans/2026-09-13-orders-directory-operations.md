# Orders Directory Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Customers-style sorting, filtering, page/all-result bulk selection, and hybrid CSV exports to the admin Orders directory.

**Architecture:** Extend `AdminCommerceService` with validated order-list contracts and one reusable SQL filter builder, then consume that contract from a client-side Orders directory whose state round-trips through the URL. Add a separate `OrderExportService`, database table, queue consumer, storage namespace, and admin API routes; the export service reuses the same order-query contract so the on-screen result set and exported result set cannot drift.

**Tech Stack:** Next.js App Router, React, TypeScript, PostgreSQL, Vitest, BullMQ/in-memory queue abstraction, private object storage abstraction.

**Spec:** `docs/superpowers/specs/2026-09-13-orders-directory-operations-design.md`

## Global Constraints

- Preserve the existing Orders views and the 30-row page size.
- Default sorting is `DATE_DESC`; every sort uses a stable order identifier tie-breaker.
- Page selection selects visible rows; all-result selection is a filter snapshot with optional UUID exclusions.
- Up to 1,000 orders export synchronously; larger exports run in the background and expire after seven days.
- Exported values come from persisted order, payment, fulfillment, and printing records.
- Do not change Order Detail Page behavior or customer export behavior.
- Use integer cents internally and USD decimal strings only at the CSV boundary.

---

### Task 1: Order list contracts and validated URL state

**Files:**

- Create: `packages/domain/src/admin-order-contracts.ts`
- Create: `packages/domain/src/admin-order-contracts.test.ts`
- Create: `apps/web/app/admin/orders/_components/order-list-url-state.ts`
- Create: `apps/web/app/admin/orders/_components/order-list-url-state.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces `AdminOrderView`, `AdminOrderSort`, `AdminOrderFilters`, `AdminOrderListOptions`, `adminOrderViews`, `adminOrderSorts`, and status allowlists.
- Produces `parseOrderListUrlState(search)` and `writeOrderListUrlState(state)` for the browser client.

- [ ] **Step 1: Write failing contract and URL round-trip tests**

```ts
expect(
  parseOrderListUrlState(
    new URLSearchParams(
      'q=taylor&view=IN_PROGRESS&sort=TOTAL_DESC&page=3&payment=SUCCEEDED&printing=PRINTED&fulfillment=FULFILLED&from=2026-09-01&to=2026-09-13&minTotal=20&maxTotal=80',
    ),
  ),
).toEqual({
  query: 'taylor',
  view: 'IN_PROGRESS',
  sort: 'TOTAL_DESC',
  page: 3,
  paymentStatus: 'SUCCEEDED',
  printingStatus: 'PRINTED',
  fulfillmentStatus: 'FULFILLED',
  dateFrom: '2026-09-01',
  dateTo: '2026-09-13',
  minTotal: '20',
  maxTotal: '80',
});
expect(adminOrderSorts).toContain('ORDER_NUMBER_ASC');
expect(adminOrderSorts).toContain('TOTAL_DESC');
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm test -- packages/domain/src/admin-order-contracts.test.ts apps/web/app/admin/orders/_components/order-list-url-state.test.ts`  
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement immutable allowlists and strict URL parsing**

Use exact sort keys:

```ts
export const adminOrderSorts = [
  'ORDER_NUMBER_ASC',
  'ORDER_NUMBER_DESC',
  'DATE_ASC',
  'DATE_DESC',
  'CUSTOMER_ASC',
  'CUSTOMER_DESC',
  'ITEMS_ASC',
  'ITEMS_DESC',
  'PAYMENT_ASC',
  'PAYMENT_DESC',
  'FULFILLMENT_ASC',
  'FULFILLMENT_DESC',
  'TOTAL_ASC',
  'TOTAL_DESC',
] as const;
```

Keep monetary URL values as strings for form fidelity; API/domain conversion happens in Task 2. Reject unknown URL enum values by returning empty filters and use `DATE_DESC`/`ALL` defaults.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm test -- packages/domain/src/admin-order-contracts.test.ts apps/web/app/admin/orders/_components/order-list-url-state.test.ts`  
Expected: both files pass.

### Task 2: Database-backed sorting and filtering

**Files:**

- Modify: `packages/domain/src/admin-commerce.ts`
- Modify: `packages/domain/src/admin-commerce.test.ts`
- Modify: `apps/web/app/api/admin/orders/route.ts`
- Create: `apps/web/app/api/admin/orders/route.test.ts`

**Interfaces:**

- `AdminCommerceService.listOrders(session, options: AdminOrderListOptions)` returns list rows including internal `id: string`, `printingStatus: string`, and `currency: string`.
- `buildAdminOrderQuery(options)` produces parameterized `whereSql`, `values`, and deterministic `orderBySql`; it is exported for the Order export service.

- [ ] **Step 1: Write failing domain tests for every sort and combined filters**

Assert that `TOTAL_DESC` orders by stored total cents, `ORDER_NUMBER_ASC` orders by the numeric sequence, and this filter combination produces parameterized predicates:

```ts
await service.listOrders(actor, {
  view: 'IN_PROGRESS',
  sort: 'TOTAL_DESC',
  paymentStatus: 'SUCCEEDED',
  printingStatus: 'PRINTED',
  fulfillmentStatus: 'FULFILLED',
  dateFrom: '2026-09-01',
  dateTo: '2026-09-13',
  minTotalCents: 2000,
  maxTotalCents: 8000,
});
expect(executedSql).toContain('ORDER BY total_cents DESC');
expect(executedSql).toContain('EXISTS');
expect(executedValues).toEqual(
  expect.arrayContaining(['SUCCEEDED', 'PRINTED', 'SHIPPED', 2000, 8000]),
);
```

Also test invalid sort/status/date/range inputs and `minTotalCents > maxTotalCents`.

- [ ] **Step 2: Run domain tests and verify RED**

Run: `pnpm test -- packages/domain/src/admin-commerce.test.ts`  
Expected: FAIL because order options and SQL mappings are missing.

- [ ] **Step 3: Implement the reusable query builder and list mapping**

Aggregate one row per order with lateral/subqueries for printing status and product names. Search order number, email, recipient name, and product model display name. Interpret `dateTo` as the exclusive start of the following UTC day after validating `YYYY-MM-DD`. Use `order_sequence` when available for numeric order sorting and `orders.id` as the final tie-breaker.

- [ ] **Step 4: Write API parsing tests before changing the route**

Test `page=nope`, `minTotal=-1`, `from=09/01/2026`, unsupported status, and reversed ranges return 400 without calling the runtime. Test valid values are converted to integer cents and passed through.

- [ ] **Step 5: Run API tests and verify RED, then implement strict route parsing**

Run: `pnpm test -- apps/web/app/api/admin/orders/route.test.ts`  
Expected before implementation: FAIL. Add helpers that distinguish missing from malformed values and never silently convert `NaN`.

- [ ] **Step 6: Run domain and API tests and verify GREEN**

Run: `pnpm test -- packages/domain/src/admin-commerce.test.ts apps/web/app/api/admin/orders/route.test.ts`

### Task 3: Client Orders directory, sorting, filters, and bulk selection

**Files:**

- Create: `apps/web/app/admin/orders/_components/order-types.ts`
- Create: `apps/web/app/admin/orders/_components/order-selection.ts`
- Create: `apps/web/app/admin/orders/_components/order-selection.test.ts`
- Create: `apps/web/app/admin/orders/_components/admin-orders-client.tsx`
- Modify: `apps/web/app/admin/orders/page.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/lib/admin-preferences.ts`
- Modify: `apps/web/lib/admin-preferences.test.ts`

**Interfaces:**

- `AdminOrdersClient` owns URL-backed query/view/sort/filter/page state and fetches `/api/admin/orders`.
- Pure selection helpers accept visible UUIDs plus `{ selected, allMatchingSelected, excluded }` and return new immutable sets.

- [ ] **Step 1: Write failing pure selection tests**

Cover selecting/clearing all 30 visible IDs, switching to all matching, excluding one row, reselecting it, clearing, and calculating `total - excluded.size`.

- [ ] **Step 2: Run selection tests and verify RED**

Run: `pnpm test -- apps/web/app/admin/orders/_components/order-selection.test.ts`

- [ ] **Step 3: Implement selection helpers and verify GREEN**

Run the same command and require all cases to pass.

- [ ] **Step 4: Write failing preference migration tests**

Assert old localStorage JSON migrates to `orderView: 'ALL'` and `orderSort: 'DATE_DESC'`, while valid saved values survive parsing.

- [ ] **Step 5: Implement preference version migration**

Add `orderView` and `orderSort` without removing or resetting saved sidebar/customer preferences.

- [ ] **Step 6: Build the client directory**

Render sortable button headers with `aria-sort`; filter popover controls for payment, printing, fulfillment, date range, and total range; debounced search; existing view tabs; loading/error/empty states; 30-row pagination; row/header checkboxes; and the bulk bar:

```tsx
<strong>{selectedCount.toLocaleString('en-US')} selected</strong>
{allOnPageSelected && !allMatchingSelected && selectedCount < result.total ? (
  <button onClick={selectAllMatchingOrders}>Select all ({result.total.toLocaleString('en-US')})</button>
) : null}
<button onClick={() => void exportOrders()}>Export selected</button>
<button onClick={clearSelection}>Clear</button>
```

Keep Total header and values right-aligned. Disable selection/export for roles without order-management access.

- [ ] **Step 7: Verify component contracts, lint, and typecheck**

Run: `pnpm test -- apps/web/app/admin/orders apps/web/lib/admin-preferences.test.ts`  
Run: `pnpm --filter @let-it-be/web typecheck`

### Task 4: Order export persistence

**Files:**

- Create: `packages/db/drizzle/0048_order_exports.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/verification.ts`
- Modify: `packages/db/src/verification.test.ts`

**Interfaces:**

- Creates `app.order_exports` with the lifecycle fields and invariants defined in the spec.

- [ ] **Step 1: Write a failing schema verification test**

Require `app.order_exports`, requester index, pending partial index, expiry partial index, status check, processed-count constraint, and READY storage/timestamp invariant.

- [ ] **Step 2: Run DB verification tests and verify RED**

Run: `pnpm test -- packages/db/src/verification.test.ts`

- [ ] **Step 3: Add migration and journal entry**

Use `customer_exports` as the structural reference, rename all table/index identifiers to order exports, and store `selection_snapshot jsonb NOT NULL`.

- [ ] **Step 4: Run DB tests and local migration verification**

Run: `pnpm test -- packages/db/src/verification.test.ts`  
Run with the development database: `pnpm db:migrate && pnpm db:verify`.

### Task 5: Hybrid OrderExportService

**Files:**

- Create: `packages/domain/src/order-exports.ts`
- Create: `packages/domain/src/order-exports.test.ts`
- Create: `packages/domain/src/order-exports.integration.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces `OrderExportSelection`, `OrderExportFilters`, `OrderExportSummary`, `OrderExportService`, `synchronousOrderExportLimit = 1_000`, and `startOrderExportConsumer`.

- [ ] **Step 1: Write failing immediate-export tests**

Assert a one-order ID selection returns `mode: 'IMMEDIATE'`, emits the 14-column header from the spec, escapes commas/quotes/newlines, aggregates multiple products into one row, formats `3999` as `39.99`, and emits persisted payment/printing/fulfillment statuses.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test -- packages/domain/src/order-exports.test.ts`

- [ ] **Step 3: Implement selection validation and synchronous CSV generation**

Reject empty ID selections, invalid UUIDs, more than 100 explicit IDs per request only if sent through the legacy compatibility path, unknown filters, and invalid exclusions. Reuse `buildAdminOrderQuery` for filter selections.

- [ ] **Step 4: Write failing queued lifecycle tests**

Cover `>1000` queueing, requester-scoped list/download, progress updates in 500-row batches, READY storage metadata, FAILED reason, seven-day expiry, pending recovery, and queue consumer payload `{ exportId }`.

- [ ] **Step 5: Implement queued lifecycle and verify unit GREEN**

Use queue `order-exports`, job name `build-order-export`, and storage key `admin/order-exports/{exportId}.csv`.

- [ ] **Step 6: Add PostgreSQL integration coverage**

Create orders with different payment, printing, fulfillment, product, total, and shipping values. Prove a filtered all-matching selection with one exclusion exports exactly the expected rows and that a queued export can be processed and downloaded.

- [ ] **Step 7: Run focused unit and integration tests**

Run: `pnpm test -- packages/domain/src/order-exports.test.ts`  
Run with `DATABASE_URL`: `pnpm test -- packages/domain/src/order-exports.integration.test.ts`.

### Task 6: API, runtime, and worker wiring

**Files:**

- Create: `apps/web/app/api/admin/orders/export/route.ts`
- Create: `apps/web/app/api/admin/orders/export/route.test.ts`
- Create: `apps/web/app/api/admin/order-exports/route.ts`
- Create: `apps/web/app/api/admin/order-exports/[exportId]/download/route.ts`
- Create: `apps/web/app/api/admin/order-exports/[exportId]/download/route.test.ts`
- Modify: `apps/web/lib/generation-runtime.ts`
- Modify: `apps/web/lib/platform.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**

- `orderExportRuntime()` exposes the singleton service.
- POST returns CSV with `200` or job summary with `202`; list/download routes are requester-scoped.

- [ ] **Step 1: Write failing route tests**

Test authentication, exact selection forwarding, 200 CSV headers, 202 queued JSON, validation error mapping, owner-only download, not-ready, expired, and missing-file responses.

- [ ] **Step 2: Run route tests and verify RED**

Run: `pnpm test -- apps/web/app/api/admin/orders/export/route.test.ts apps/web/app/api/admin/order-exports/[exportId]/download/route.test.ts`

- [ ] **Step 3: Implement routes and runtime singleton**

Instantiate `OrderExportService` beside `CustomerExportService`. For the memory queue, register its consumer in web runtime. In the worker, register the consumer, recover pending IDs, process them, expire ready jobs, and log under `worker.order_export_*` keys.

- [ ] **Step 4: Run route and runtime typechecks**

Run: `pnpm test -- apps/web/app/api/admin/orders/export/route.test.ts apps/web/app/api/admin/order-exports`  
Run: `pnpm --filter @let-it-be/web typecheck && pnpm --filter @let-it-be/worker typecheck`.

### Task 7: Export UI and browser behavior

**Files:**

- Modify: `apps/web/app/admin/orders/_components/admin-orders-client.tsx`
- Create: `apps/web/app/admin/orders/_components/order-export-ui.test.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- The Orders client requests immediate/queued exports, polls active jobs every three seconds, and provides ready downloads.

- [ ] **Step 1: Write failing export UI contract tests**

Assert `activeOrderSelection()` creates exact ID and filter snapshots, includes exclusions, uses the filtered total for feedback, and prevents concurrent export submissions.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `pnpm test -- apps/web/app/admin/orders/_components/order-export-ui.test.ts`

- [ ] **Step 3: Implement Export page, Export selected, and Exports popover**

Use `/api/admin/orders/export`, `/api/admin/order-exports`, and the download route. For a 200 response, download `orders-YYYY-MM-DD.csv`; for 202, prepend the job and display `Export started for N orders. You can safely leave this page.` Poll only while a job is QUEUED or PROCESSING.

- [ ] **Step 4: Style consistently with Customers and verify GREEN**

Reuse admin design tokens and matching bulk-bar/popover dimensions without coupling Orders to customer class names. Run all `apps/web/app/admin/orders` tests.

### Task 8: Full verification and handoff

**Files:**

- Modify only files required by failures attributable to this feature.

- [ ] **Step 1: Format and inspect the diff**

Run: `pnpm format`  
Run: `git diff --check`  
Confirm unrelated pre-existing order-detail changes remain intact.

- [ ] **Step 2: Run the full automated gate**

Run: `pnpm lint`  
Run: `pnpm typecheck`  
Run: `pnpm test`  
Run with development PostgreSQL: `pnpm test:integration`  
Run: `pnpm build`.

- [ ] **Step 3: Perform desktop browser validation**

At `/admin/orders`, verify each sortable header in both directions; combined payment/printing/fulfillment/date/total filters; URL persistence after refresh; current-page select/clear; `Select all (N)`; individual exclusion; immediate page export; queued export state and ready download; pagination; empty and API-error states; and Total header/value alignment.

- [ ] **Step 4: Report evidence and remaining limitations**

List files changed, migration applied, exact test counts, browser scenarios exercised, whether background mode was proven with a real queue or the in-memory adapter, and any environment limitation. Do not commit or push the implementation until explicitly requested.
