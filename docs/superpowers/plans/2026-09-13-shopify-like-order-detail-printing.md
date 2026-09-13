# Shopify-like Order Detail and Printing Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a commerce-first Shopify-like Order Detail Page backed entirely by durable order data, with independent Payment, Printing, and Fulfillment states plus a compact printing summary that opens a full operations modal.

**Architecture:** Introduce typed order-detail projections and separate group-level printing/fulfillment persistence while retaining the legacy mixed order status as a temporary compatibility projection. A dedicated `OrderDetailService` owns the page DTO, group modal DTO, notes/tags, and unified timeline; the web layer consumes explicit routes and focused React components rather than merging overlapping commerce and operations objects.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PostgreSQL SQL migrations, Vitest, existing domain/service/runtime patterns, native HTML dialog semantics and CSS.

**Spec:** `docs/superpowers/specs/2026-09-13-shopify-like-order-detail-printing-design.md`

## Global Constraints

- Preserve all existing uncommitted Customer work; never stage or rewrite unrelated Customer files.
- Every displayed operational value comes from a durable record, provider response, or deterministic server projection.
- Payment, Printing, and Fulfillment are independent state layers; cross-layer guards do not mutate unrelated states.
- Keep `orders.status` only as a temporary compatibility projection and never use it as the new ODP badge authority.
- Use integer USD cents and frozen snapshots for historical financial calculations.
- Never expose production masters, provider derivatives, storage keys, raw provider payloads, payment credentials, or security-sensitive metadata.
- Keep the admin phase desktop-first and Shopify-like; do not add pickup point, metafields, app blocks, order risk, or synthetic conversion attribution.
- Use TDD for every behavior change and commit only the files belonging to the completed task.

---

### Task 1: Independent order-layer contracts and projections

**Files:**

- Create: `packages/domain/src/order-detail-contracts.ts`
- Create: `packages/domain/src/order-detail-contracts.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Consumes: current payment statuses, refund totals, provider-group state inputs, and shipment quantity inputs.
- Produces: `PaymentState`, `PrintingGroupState`, `OrderPrintingState`, `FulfillmentState`, `projectPaymentState`, `aggregatePrintingState`, and `projectFulfillmentState`.

- [ ] **Step 1: Write failing table-driven projection tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  aggregatePrintingState,
  projectFulfillmentState,
  projectPaymentState,
} from './order-detail-contracts.js';

describe('order detail state projections', () => {
  it.each([
    [{ paymentStatus: 'SUCCEEDED', paidCents: 9306, refundedCents: 0 }, 'PAID'],
    [{ paymentStatus: 'SUCCEEDED', paidCents: 9306, refundedCents: 3000 }, 'PARTIALLY_REFUNDED'],
    [{ paymentStatus: 'SUCCEEDED', paidCents: 9306, refundedCents: 9306 }, 'REFUNDED'],
    [{ paymentStatus: 'FAILED', paidCents: 0, refundedCents: 0 }, 'FAILED'],
  ] as const)('projects payment evidence to %s', (input, expected) => {
    expect(projectPaymentState(input)).toBe(expected);
  });

  it('keeps printed and unfulfilled as a valid combination', () => {
    expect(aggregatePrintingState(['PRINTED'])).toBe('PRINTED');
    expect(
      projectFulfillmentState({ totalQuantity: 2, fulfilledQuantity: 0, deliveredQuantity: 0 }),
    ).toBe('UNFULFILLED');
  });

  it('aggregates mixed provider groups without hiding partial production', () => {
    expect(aggregatePrintingState(['IN_PRODUCTION', 'SUBMITTED'])).toBe('PARTIALLY_IN_PRODUCTION');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test -- packages/domain/src/order-detail-contracts.test.ts`  
Expected: FAIL because `order-detail-contracts.ts` and its exports do not exist.

- [ ] **Step 3: Implement exhaustive typed projections**

```ts
export const paymentStates = [
  'PENDING',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FAILED',
  'CANCELLED',
] as const;
export type PaymentState = (typeof paymentStates)[number];

export const printingGroupStates = [
  'NOT_STARTED',
  'PREPRESS_REVIEW',
  'COMPLIANCE_REVIEW',
  'READY_FOR_PRODUCTION',
  'SUBMITTING',
  'SUBMITTED',
  'IN_PRODUCTION',
  'PRINTED',
  'ON_HOLD',
  'FAILED',
  'CANCELLED',
] as const;
export type PrintingGroupState = (typeof printingGroupStates)[number];
export type OrderPrintingState =
  PrintingGroupState | 'PARTIALLY_IN_PRODUCTION' | 'PARTIALLY_PRINTED' | 'NEEDS_ATTENTION';
export type FulfillmentState =
  'UNFULFILLED' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'DELIVERED' | 'CANCELLED';

export function projectPaymentState(input: {
  paymentStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | null;
  paidCents: number;
  refundedCents: number;
}): PaymentState {
  if (input.paymentStatus === 'FAILED') return 'FAILED';
  if (input.paymentStatus === 'CANCELLED') return 'CANCELLED';
  if (input.paymentStatus !== 'SUCCEEDED') return 'PENDING';
  if (input.refundedCents >= input.paidCents && input.paidCents > 0) return 'REFUNDED';
  if (input.refundedCents > 0) return 'PARTIALLY_REFUNDED';
  return 'PAID';
}
```

Implement `aggregatePrintingState` with explicit precedence (`FAILED`/`ON_HOLD` → `NEEDS_ATTENTION`, all identical → that state, printed mix → `PARTIALLY_PRINTED`, production/submitted mix → `PARTIALLY_IN_PRODUCTION`) and `projectFulfillmentState` from quantities rather than printing state.

- [ ] **Step 4: Run the focused test and repository typecheck**

Run: `pnpm test -- packages/domain/src/order-detail-contracts.test.ts`  
Expected: PASS.  
Run: `pnpm --filter @let-it-be/domain typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit the state projection deliverable**

```bash
git add packages/domain/src/order-detail-contracts.ts packages/domain/src/order-detail-contracts.test.ts packages/domain/src/index.ts
git commit -m "Add independent order layer projections"
```

### Task 2: Persist separate printing and fulfillment evidence

**Files:**

- Create: `packages/db/drizzle/0046_order_detail_layers.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/required-tables.ts`
- Modify: `packages/db/src/required-tables.test.ts`
- Create: `packages/domain/src/order-detail.integration.test.ts`
- Modify: `scripts/run-integration-tests.ts`

**Interfaces:**

- Consumes: Task 1 enums and existing `order_fulfillment_groups`, shipments, reviews, provider events, staff members, and orders.
- Produces: `printing_status`, `fulfillment_status`, synchronization/economics snapshots, normalized history tables, order notes, and order tags.

- [ ] **Step 1: Extend required-table and integration assertions first**

Add expectations for these exact tables:

```ts
for (const table of [
  'order_printing_status_events',
  'order_fulfillment_status_history',
  'order_notes',
  'order_tags',
  'order_tag_assignments',
]) {
  expect(requiredApplicationTables).toContain(table);
}
```

Create an integration test that inserts a legacy `SHIPPED` group plus shipment evidence and asserts the migrated/read projection is Printing `PRINTED` and Fulfillment `FULFILLED`, never one shared state.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test -- packages/db/src/required-tables.test.ts packages/domain/src/order-detail.integration.test.ts`  
Expected: FAIL because migration tables/columns do not exist.

- [ ] **Step 3: Add migration with constrained independent columns and tables**

The migration must add:

```sql
ALTER TABLE app.order_fulfillment_groups
  ADD COLUMN printing_status text,
  ADD COLUMN fulfillment_status text,
  ADD COLUMN last_provider_sync_at timestamptz,
  ADD COLUMN production_economics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE app.order_printing_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  fulfillment_group_id uuid NOT NULL REFERENCES app.order_fulfillment_groups(id) ON DELETE RESTRICT,
  from_state text,
  to_state text NOT NULL,
  source text NOT NULL CHECK (source IN ('SYSTEM','OPS','WEBHOOK','POLLING','MIGRATION')),
  external_event_id text,
  raw_status text,
  disposition text NOT NULL DEFAULT 'APPLIED' CHECK (disposition IN ('APPLIED','DUPLICATE','CONFLICT','UNKNOWN')),
  actor_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Add the remaining tables with these contracts:

```sql
CREATE TABLE app.order_fulfillment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  fulfillment_group_id uuid NOT NULL REFERENCES app.order_fulfillment_groups(id) ON DELETE RESTRICT,
  from_state text,
  to_state text NOT NULL,
  source text NOT NULL CHECK (source IN ('SYSTEM','OPS','WEBHOOK','POLLING','MIGRATION')),
  shipment_id uuid REFERENCES app.order_shipments(id) ON DELETE SET NULL,
  actor_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.order_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_by_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.order_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  value text NOT NULL CHECK (length(value) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX order_tags_value_case_insensitive_idx ON app.order_tags(lower(value));
CREATE TABLE app.order_tag_assignments (
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE CASCADE,
  order_tag_id uuid NOT NULL REFERENCES app.order_tags(id) ON DELETE CASCADE,
  created_by_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, order_tag_id)
);
```

Add `(order_id, created_at DESC)` and `(fulfillment_group_id, created_at DESC)` history indexes. Backfill `printing_status` from the legacy group status and `fulfillment_status` from shipment/delivery evidence using the exact mapping in the spec, then make both columns `NOT NULL` with CHECK constraints.

- [ ] **Step 4: Journal, migrate, and verify the database**

Add journal tag `0046_order_detail_layers` after `0045_customer_marketing_consent_states`.  
Run: `pnpm db:migrate`  
Expected: migration applied successfully.  
Run: `pnpm db:verify`  
Expected: all required application tables present.

- [ ] **Step 5: Run focused and integration tests**

Run: `pnpm test -- packages/db/src/required-tables.test.ts packages/domain/src/order-detail.integration.test.ts`  
Expected: PASS.  
Run: `pnpm test:integration`  
Expected: PASS with the new test included.

- [ ] **Step 6: Commit the migration deliverable**

```bash
git add packages/db/drizzle/0046_order_detail_layers.sql packages/db/drizzle/meta/_journal.json packages/db/src/required-tables.ts packages/db/src/required-tables.test.ts packages/domain/src/order-detail.integration.test.ts scripts/run-integration-tests.ts
git commit -m "Separate printing and fulfillment order state"
```

### Task 3: Make operations write the independent layers

**Files:**

- Modify: `packages/domain/src/order-operations.ts`
- Modify: `packages/domain/src/commerce.integration.test.ts`
- Modify: `packages/domain/src/fulfillment-routing.integration.test.ts`
- Modify: `packages/domain/src/order-detail.integration.test.ts`

**Interfaces:**

- Consumes: `PrintingGroupState`, fulfillment states, existing provider webhooks/polling, fulfillment actions, shipments, and compatibility `orders.status` transitions.
- Produces: `transitionPrintingGroup`, `reconcileFulfillmentGroup`, and normalized layer event writes used by Task 4 reads.

- [ ] **Step 1: Add failing lifecycle tests**

Add integration cases proving:

```ts
expect(group).toMatchObject({
  printing_status: 'IN_PRODUCTION',
  fulfillment_status: 'UNFULFILLED',
});
```

after an `in_production` provider event, and:

```ts
expect(group).toMatchObject({
  printing_status: 'PRINTED',
  fulfillment_status: 'FULFILLED',
});
```

only after shipment evidence is persisted. Add a duplicate webhook test asserting one applied printing event and no duplicated shipment/history row.

- [ ] **Step 2: Run integration tests and verify RED**

Run: `pnpm test:integration`  
Expected: FAIL because operations still update the mixed `status` field.

- [ ] **Step 3: Implement independent transition helpers**

Add transaction-scoped helpers with these signatures:

```ts
async function transitionPrintingGroup(
  client: SqlClient,
  input: {
    orderId: string;
    fulfillmentGroupId: string;
    from: PrintingGroupState;
    to: PrintingGroupState;
    source: 'SYSTEM' | 'OPS' | 'WEBHOOK' | 'POLLING';
    externalEventId?: string;
    rawStatus?: string;
    actorStaffMemberId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void>;

async function reconcileFulfillmentGroup(
  client: SqlClient,
  fulfillmentGroupId: string,
  source: 'SYSTEM' | 'WEBHOOK' | 'POLLING',
): Promise<FulfillmentState>;
```

Provider `submitted`, `in_production`, and completion events update only `printing_status`. Shipment/delivery evidence updates only `fulfillment_status`. Continue updating legacy fields only through an isolated compatibility helper with tests showing the new projections do not read it.

- [ ] **Step 4: Preserve automation and exception audit contracts**

Submission remains idempotent through `order_fulfillment_actions`. Webhooks retain raw status only in server-side event evidence. Hold/resume/retry/cancel/manual reconciliation must write actor, reason, result, and before/after metadata without rewriting prior evidence.

- [ ] **Step 5: Run integration suite and typecheck**

Run: `pnpm test:integration`  
Expected: PASS.  
Run: `pnpm --filter @let-it-be/domain typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit the operations deliverable**

```bash
git add packages/domain/src/order-operations.ts packages/domain/src/commerce.integration.test.ts packages/domain/src/fulfillment-routing.integration.test.ts packages/domain/src/order-detail.integration.test.ts
git commit -m "Persist independent print and fulfillment transitions"
```

### Task 4: Build the typed Order Detail read model

**Files:**

- Create: `packages/domain/src/order-detail.ts`
- Create: `packages/domain/src/order-detail.test.ts`
- Modify: `packages/domain/src/order-detail.integration.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `apps/web/lib/platform.ts`

**Interfaces:**

- Consumes: Task 1 projections and Task 2/3 persistence.
- Produces: `OrderDetailService.getOrder(session, orderNumber): Promise<AdminOrderDetail | null>` and `getPrintingGroup(session, orderNumber, groupId): Promise<PrintingGroupDetail | null>`.

- [ ] **Step 1: Define and test the DTO boundary**

The page DTO must have this top-level shape:

```ts
export interface AdminOrderDetail {
  orderNumber: string;
  createdAt: Date;
  salesChannel: string;
  paymentState: PaymentState;
  printingState: OrderPrintingState;
  fulfillmentState: FulfillmentState;
  customer: {
    id: string | null;
    name: string;
    email: string;
    phone: string | null;
    orderCount: number;
  };
  shippingAddress: PostalAddressSnapshot;
  billingAddress: PostalAddressSnapshot;
  billingMatchesShipping: boolean;
  financials: OrderFinancialSummary;
  groups: AdminOrderGroupSummary[];
  notes: AdminOrderNote[];
  tags: string[];
}
```

Write tests that reject overlap keys from the old commerce/operations merge and assert literal projections for subtotal, discounts, shipping, tax, total, paid, refunded, and group economics.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test -- packages/domain/src/order-detail.test.ts`  
Expected: FAIL because the service and DTO do not exist.

- [ ] **Step 3: Implement one explicit SQL-backed projection**

`OrderDetailService` validates staff read access, loads the order/customer/payment/refund data, loads groups/items/shipments, then applies Task 1 pure functions. Parse JSON snapshots through validating helpers rather than unchecked casts. Return `null` for a missing order and `null` for a group that does not belong to that order.

`getPrintingGroup` returns identifiers, persisted dates, readiness evidence, group items, safe asset metadata, frozen economics, shipments, permitted action descriptors, last sync, staleness, and normalized safe errors. It never returns raw provider payloads or private asset keys.

- [ ] **Step 4: Register the runtime and remove overlapping merge ownership**

Add `orderDetailRuntime()` in `apps/web/lib/platform.ts` following existing singleton/runtime construction. Keep `AdminCommerceService` list/dashboard responsibilities; route all ODP reads through `OrderDetailService`.

- [ ] **Step 5: Run focused, integration, and type tests**

Run: `pnpm test -- packages/domain/src/order-detail.test.ts`  
Expected: PASS.  
Run: `pnpm test:integration`  
Expected: PASS.  
Run: `pnpm --filter @let-it-be/domain typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit the read-model deliverable**

```bash
git add packages/domain/src/order-detail.ts packages/domain/src/order-detail.test.ts packages/domain/src/order-detail.integration.test.ts packages/domain/src/index.ts apps/web/lib/platform.ts
git commit -m "Add typed admin order detail read model"
```

### Task 5: Persist order notes/tags and project the unified timeline

**Files:**

- Modify: `packages/domain/src/order-detail.ts`
- Modify: `packages/domain/src/order-detail.test.ts`
- Modify: `packages/domain/src/order-detail.integration.test.ts`

**Interfaces:**

- Consumes: Task 2 order note/tag tables and existing order/payment/refund/printing/shipment/audit tables.
- Produces: `addOrderNote`, `replaceOrderTags`, `listOrderTags`, and `listTimeline`.

- [ ] **Step 1: Add failing persistence and timeline tests**

Test that notes and tags survive a new service instance, record the staff actor, and add timeline entries. Add a literal timeline fixture spanning two dates and assert newest-first ordering, date grouping input, and cursor pagination at exactly 10 entries.

```ts
const firstPage = await service.listTimeline(actor, orderNumber, { limit: 10 });
expect(firstPage.events).toHaveLength(10);
expect(firstPage.nextCursor).toBeTruthy();
expect(firstPage.events.map((event) => event.occurredAt.toISOString())).toEqual(
  [...expectedIsoDates].sort().reverse().slice(0, 10),
);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test -- packages/domain/src/order-detail.test.ts packages/domain/src/order-detail.integration.test.ts`  
Expected: FAIL because mutation and timeline methods do not exist.

- [ ] **Step 3: Implement notes and canonical case-insensitive tags**

`addOrderNote` rejects blank or oversized text, inserts actor attribution, and writes an operational audit. `replaceOrderTags` trims, deduplicates case-insensitively, upserts canonical tags, replaces only that order’s assignments transactionally, and audits added/removed tags.

- [ ] **Step 4: Implement the safe timeline projection**

Use a SQL `UNION ALL` CTE across order creation/history, payment events, successful refunds, printing status events, operational audits, fulfillment history/shipments, notes, tags, and order-associated lifecycle deliveries. Normalize each row to:

```ts
export interface AdminOrderTimelineEvent {
  id: string;
  type: string;
  occurredAt: Date;
  source: 'CUSTOMER' | 'STAFF' | 'SYSTEM' | 'PAYMENT_PROVIDER' | 'PRINT_PROVIDER' | 'CARRIER';
  actorName: string | null;
  description: string;
  details: Record<string, string | number | boolean | null>;
}
```

Use keyset cursor `(occurred_at, id)`, cap limit at 50, default to 10, and whitelist details per event type.

- [ ] **Step 5: Run focused and integration tests**

Run: `pnpm test -- packages/domain/src/order-detail.test.ts`  
Expected: PASS.  
Run: `pnpm test:integration`  
Expected: PASS.

- [ ] **Step 6: Commit the persisted sidebar/timeline deliverable**

```bash
git add packages/domain/src/order-detail.ts packages/domain/src/order-detail.test.ts packages/domain/src/order-detail.integration.test.ts
git commit -m "Add persisted order notes tags and timeline"
```

### Task 6: Expose explicit admin Order Detail APIs

**Files:**

- Modify: `apps/web/app/api/admin/orders/[orderNumber]/route.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/printing-groups/[groupId]/route.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/timeline/route.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/notes/route.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/tags/route.ts`
- Modify: `apps/web/app/api/admin/orders/[orderNumber]/actions/route.ts`
- Create: corresponding `route.test.ts` files beside each new route.

**Interfaces:**

- Consumes: Task 4/5 `OrderDetailService` methods.
- Produces: authenticated page, modal, timeline, note, tag, and action JSON contracts.

- [ ] **Step 1: Write failing route boundary tests**

Test 401/403 behavior through the existing session helper, 404 for missing/mismatched group IDs, 400 for invalid body/cursor, and exact response shapes. Assert the page GET calls only `getOrder` and no longer spreads two service objects.

- [ ] **Step 2: Run route tests and verify RED**

Run: `pnpm test -- apps/web/app/api/admin/orders`  
Expected: FAIL because the new endpoints do not exist and the current GET still merges objects.

- [ ] **Step 3: Implement GET boundaries**

Use `requireAdminSession`, `orderDetailRuntime`, `handleRouteError`, and `force-dynamic`. Modal GET must pass both `orderNumber` and `groupId` to enforce ownership. Timeline accepts only an opaque cursor and bounded limit.

- [ ] **Step 4: Implement mutation boundaries**

Notes accept `{ body: string }`; tags accept `{ tags: string[] }`. Extend actions with explicit, validated printing-group IDs and supported actions only. Require reason codes for manual reconciliation, hold, reroute, cancel, refund, and reprint operations.

- [ ] **Step 5: Run route tests and web typecheck**

Run: `pnpm test -- apps/web/app/api/admin/orders`  
Expected: PASS.  
Run: `pnpm --filter @let-it-be/web typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit the API deliverable**

```bash
git add apps/web/app/api/admin/orders
git commit -m "Expose admin order detail operations APIs"
```

### Task 7: Build the Shopify-like page and hybrid printing modal

**Files:**

- Refactor: `apps/web/app/admin/orders/[orderNumber]/admin-order-detail.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/order-detail-types.ts`
- Create: `apps/web/app/admin/orders/[orderNumber]/order-status-badges.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/order-fulfillment-group.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/order-printing-summary.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/order-printing-modal.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/order-payment-summary.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/order-detail-sidebar.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/order-timeline.tsx`
- Create: focused `.test.ts`/`.test.tsx` files for pure formatters, state labels, modal state, and timeline grouping.
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- Consumes: Task 6 JSON contracts.
- Produces: the approved commerce-first two-column ODP and lazy-loaded printing modal.

- [ ] **Step 1: Add failing client behavior tests**

Cover literal label/color mappings for all three layers, address formatting, financial formatting, timeline grouping, group-summary attention state, and modal state transitions. Add an interaction test proving the summary is a button, opens group-scoped content, closes on close/Escape/backdrop, and restores page scroll.

- [ ] **Step 2: Run focused UI tests and verify RED**

Run: `pnpm test -- apps/web/app/admin/orders/[orderNumber]`  
Expected: FAIL because the focused components do not exist.

- [ ] **Step 3: Implement the page skeleton and real data sections**

Replace the existing `ops-technical-details` accordion and merged `OperationalOrderDetail` type. Render a centered detail container with header badges, fulfillment groups/items, printing summaries, payment summary, timeline, and right sidebar. Empty optional fields use `—`; components never supply fake dates, prices, provider IDs, tracking, customer counts, or statuses.

- [ ] **Step 4: Implement the lazy printing modal**

Fetch `/api/admin/orders/{orderNumber}/printing-groups/{groupId}` only after activation. Use `role="dialog"`, `aria-modal="true"`, labelled title, focus trap/restoration, Escape and backdrop close, document scroll lock, loading skeleton, contained error/retry state, and unchanged underlying page scroll position.

- [ ] **Step 5: Implement notes, tags, actions, and timeline pagination**

Notes/tags save through their APIs and refresh the affected sidebar/timeline state. Timeline renders date groups and fetches the next cursor in pages of 10. Only server-returned permitted actions render; mutation success reloads the group/page data and failure remains in context.

- [ ] **Step 6: Apply Shopify-like styling without copying excluded blocks**

Use existing admin CSS variables and typography. Keep state pills compact; printing summaries use a subtle attention border only when needed. Main/aside proportions follow the approved mockup. Preserve collapsed sidebar behavior and full-width admin shell gutters while constraining only the ODP content width.

- [ ] **Step 7: Run UI tests, lint, and web build**

Run: `pnpm test -- apps/web/app/admin/orders/[orderNumber]`  
Expected: PASS.  
Run: `pnpm lint`  
Expected: PASS.  
Run: `pnpm --filter @let-it-be/web build`  
Expected: PASS, aside from the already-known Next.js middleware deprecation warning.

- [ ] **Step 8: Commit the UI deliverable**

```bash
git add apps/web/app/admin/orders/[orderNumber] apps/web/app/globals.css
git commit -m "Build Shopify-like admin order detail page"
```

### Task 8: Final hardening and end-to-end verification

**Files:**

- Modify only files implicated by failures found in this task.
- Update: `docs/superpowers/plans/2026-09-13-shopify-like-order-detail-printing.md` checkboxes as each task completes.

**Interfaces:**

- Consumes: Tasks 1–7.
- Produces: verified migrations, backend behavior, routes, and desktop admin interaction.

- [ ] **Step 1: Run migration and database verification from a clean test database**

Run: `pnpm db:verify`  
Expected: PASS with every checked-in table present and journal consistency intact.  
Run: `pnpm test:integration`  
Expected: PASS with independent mixed-state, multi-provider, split-shipment, note/tag, timeline, and modal-isolation coverage.

- [ ] **Step 2: Run the full repository gate**

Run: `pnpm format:check`  
Run: `pnpm lint`  
Run: `pnpm typecheck`  
Run: `pnpm test`  
Run: `pnpm build`  
Expected: all commands exit 0; skipped integration tests in the unit run remain covered by the explicit integration command.

- [ ] **Step 3: Perform desktop browser verification**

At desktop widths with expanded and icon-only admin sidebars, verify:

1. Order list opens a real order.
2. Header shows independent Payment, Printing, and Fulfillment badges.
3. Item, customer, address, payment, cost, shipment, and timeline values match persisted records.
4. Each provider summary opens only its own modal data.
5. Modal close button, Escape, and backdrop restore focus/scroll.
6. Timeline pagination returns 10 records grouped by date.
7. Notes/tags persist after reload.
8. Allowed actions work; forbidden actions do not render and direct API attempts are rejected.
9. Missing estimates/costs render unavailable rather than invented values.

- [ ] **Step 4: Inspect the final diff and preserve unrelated work**

Run: `git diff --check`  
Run: `git status --short`  
Expected: no whitespace errors; pre-existing Customer changes remain present and unstaged unless separately committed by the user.

- [ ] **Step 5: Report verification honestly**

Report automated command results, desktop browser checks actually performed, migrations applied, files/commits created, known warnings, and any verification not physically performed. Do not claim physical-device testing.
