# Order Admin Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add database-backed Edit, Cancel, Refund, Return, Archive, and Unarchive actions to the Shopify-like Order Detail Page while preserving independent Payment, Printing, Fulfillment, Return, and Refund layers.

**Architecture:** Add a pure eligibility contract and an `OrderAdminActionsService` that coordinates existing order, payment, fulfillment, Store Credit, and lifecycle boundaries under database locks and idempotency keys. Extend the Order Detail read model with authoritative action capabilities and financial/return/archive data, then expose separate mutation APIs and focused React modals behind a context-aware `More actions` menu.

**Tech Stack:** Next.js App Router, React, TypeScript, PostgreSQL/Drizzle SQL migrations, Vitest, existing payment and fulfillment adapters, lifecycle delivery service, and the existing admin design system.

**Spec:** `docs/superpowers/specs/2026-09-13-order-admin-actions-design.md`

## Global Constraints

- Payment, Printing, Fulfillment, Return, and Refund remain independent layers.
- Cancel is unavailable after fulfillment or after Printing reaches `IN_PRODUCTION` or `PRINTED`.
- Cancel never restocks inventory; provider catalog sync remains the only availability source.
- Return never creates a Refund, Store Credit, replacement, or reprint.
- Refund never creates a Return.
- Archive is organizational metadata, not an order status.
- All monetary values use persisted order currency and integer minor units.
- All mutations require Owner/Operations permission, a 12–120 character idempotency key, database locking, audit history, and server-side eligibility revalidation.
- A multi-provider order becomes canonically cancelled only after every required provider cancellation succeeds; partial cancellation places it on operational hold.
- Read-only staff can inspect action history but cannot invoke mutations.
- Local notification verification may persist lifecycle events without claiming real email delivery.

---

### Task 1: Action contracts and pure eligibility engine

**Files:**

- Create: `packages/domain/src/order-admin-actions-contracts.ts`
- Create: `packages/domain/src/order-admin-actions-contracts.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces `OrderAdminAction`, `OrderActionEligibilityInput`, `OrderActionEligibility`, `OrderEditFieldEligibility`, `ReturnState`, `RefundDestination`, `CancellationStatus`, and `resolveOrderActionEligibility(input)`.
- Consumes existing `PaymentState`, `PrintingGroupState`, and `FulfillmentState` from `order-detail-contracts.ts`, plus `StaffRole` from `staff-identity.ts`.

- [ ] **Step 1: Write failing eligibility matrix tests**

```ts
expect(
  resolveOrderActionEligibility({
    role: 'OPERATIONS',
    paymentState: 'PAID',
    printingStates: ['NOT_STARTED'],
    fulfillmentState: 'UNFULFILLED',
    archived: false,
    refundableCents: 3999,
    returnableQuantity: 0,
    hasShippedQuantity: false,
  }),
).toMatchObject({
  actions: { edit: true, cancel: true, refund: true, return: false, archive: false },
  editFields: { items: true, shippingAddress: true },
});

expect(
  resolveOrderActionEligibility({
    role: 'OPERATIONS',
    paymentState: 'PAID',
    printingStates: ['IN_PRODUCTION'],
    fulfillmentState: 'UNFULFILLED',
    archived: false,
    refundableCents: 3999,
    returnableQuantity: 0,
    hasShippedQuantity: false,
  }).actions.cancel,
).toBe(false);
```

Add cases for fulfilled and partially fulfilled cancellation, `SUBMITTING`, mixed-group `PARTIALLY_IN_PRODUCTION`, refund with zero balance, Return with returnable fulfilled quantity, Archive for fulfilled/delivered/cancelled only, Unarchive, read-only staff, item editing after production, and shipping-address editing after shipment.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `pnpm test -- packages/domain/src/order-admin-actions-contracts.test.ts`  
Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Implement immutable enums and the pure resolver**

```ts
export const orderAdminActions = [
  'EDIT',
  'CANCEL',
  'REFUND',
  'RETURN',
  'ARCHIVE',
  'UNARCHIVE',
] as const;
export const returnStates = [
  'REQUESTED',
  'APPROVED',
  'IN_TRANSIT',
  'RECEIVED',
  'CLOSED',
  'REJECTED',
] as const;
export const refundDestinations = ['ORIGINAL_PAYMENT', 'STORE_CREDIT', 'LATER'] as const;
export const cancellationStatuses = [
  'REQUESTED',
  'PROCESSING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
] as const;

export type OrderAdminAction = (typeof orderAdminActions)[number];
export type ReturnState = (typeof returnStates)[number];
export type RefundDestination = (typeof refundDestinations)[number];
export type CancellationStatus = (typeof cancellationStatuses)[number];

export interface OrderActionEligibilityInput {
  role: StaffRole;
  paymentState: PaymentState;
  printingStates: readonly PrintingGroupState[];
  fulfillmentState: FulfillmentState;
  archived: boolean;
  refundableCents: number;
  returnableQuantity: number;
  hasShippedQuantity: boolean;
}

export interface OrderEditFieldEligibility {
  items: boolean;
  pricing: boolean;
  shippingAddress: boolean;
  contact: boolean;
  notesAndTags: boolean;
}

export interface OrderActionEligibility {
  actions: Record<Lowercase<OrderAdminAction>, boolean>;
  editFields: OrderEditFieldEligibility;
}

export function resolveOrderActionEligibility(
  input: OrderActionEligibilityInput,
): OrderActionEligibility {
  const canMutate = input.role === 'OWNER' || input.role === 'OPERATIONS';
  const productionLocked = input.printingStates.some((state) =>
    ['IN_PRODUCTION', 'PRINTED'].includes(state),
  );
  const cancellationLocked = input.printingStates.some((state) =>
    ['SUBMITTING', 'IN_PRODUCTION', 'PRINTED'].includes(state),
  );
  const fulfilled = ['FULFILLED', 'DELIVERED'].includes(input.fulfillmentState);
  const fullyUnfulfilled = input.fulfillmentState === 'UNFULFILLED';
  return {
    actions: {
      edit: canMutate,
      cancel: canMutate && fullyUnfulfilled && !cancellationLocked,
      refund: canMutate && input.refundableCents > 0,
      return: canMutate && input.returnableQuantity > 0,
      archive:
        canMutate && !input.archived && (fulfilled || input.fulfillmentState === 'CANCELLED'),
      unarchive: canMutate && input.archived,
    },
    editFields: {
      items: canMutate && !productionLocked,
      pricing: canMutate && !productionLocked,
      shippingAddress: canMutate && !input.hasShippedQuantity,
      contact: canMutate,
      notesAndTags: canMutate,
    },
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm test -- packages/domain/src/order-admin-actions-contracts.test.ts`  
Expected: all eligibility cases pass.

- [ ] **Step 5: Commit the contracts**

```powershell
git add -- packages/domain/src/order-admin-actions-contracts.ts packages/domain/src/order-admin-actions-contracts.test.ts packages/domain/src/index.ts
git commit -m "feat: define order admin action eligibility"
```

---

### Task 2: Persistence for cancellations, returns, archive state, and edit revisions

**Files:**

- Create: `packages/db/drizzle/0049_order_admin_actions.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/required-tables.ts`
- Modify: `packages/db/src/required-tables.test.ts`

**Interfaces:**

- Produces archive and edit-balance columns on `app.orders`.
- Produces `app.order_cancellations`, `app.order_cancellation_groups`, `app.order_returns`, `app.order_return_items`, `app.order_return_events`, and `app.order_revisions`.
- Extends `app.order_refunds` with staff actor, destination, and optional Store Credit ledger linkage.
- Extends `app.order_operational_audits` with a nullable, uniquely indexed action idempotency key used by Archive, Unarchive, cancellation retries, and other audit-only mutations.

- [ ] **Step 1: Add failing required-table and migration-contract tests**

Require all six new tables and assert the migration contains:

```ts
expect(sql).toContain(
  "CHECK (status IN ('REQUESTED','PROCESSING','SUCCEEDED','PARTIAL','FAILED'))",
);
expect(sql).toContain(
  "CHECK (state IN ('REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','CLOSED','REJECTED'))",
);
expect(sql).toContain('UNIQUE (order_id, idempotency_key)');
expect(sql).toContain('CHECK (quantity > 0)');
```

- [ ] **Step 2: Run database tests and verify RED**

Run: `pnpm test -- packages/db/src/required-tables.test.ts`  
Expected: FAIL because migration 0049 and required table entries do not exist.

- [ ] **Step 3: Write migration 0049 with explicit invariants**

Add to `app.orders`:

```sql
ALTER TABLE app.orders
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL,
  ADD COLUMN amount_due_cents integer NOT NULL DEFAULT 0 CHECK (amount_due_cents >= 0),
  ADD COLUMN refundable_adjustment_cents integer NOT NULL DEFAULT 0 CHECK (refundable_adjustment_cents >= 0);

ALTER TABLE app.order_operational_audits
  ADD COLUMN idempotency_key text
    CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 12 AND 120);

CREATE UNIQUE INDEX order_operational_audits_idempotency_idx
  ON app.order_operational_audits(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

Create the six action tables with these exact contracts:

```sql
CREATE TABLE app.order_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('REQUESTED','PROCESSING','SUCCEEDED','PARTIAL','FAILED')),
  refund_destination text NOT NULL CHECK (refund_destination IN ('ORIGINAL_PAYMENT','STORE_CREDIT','LATER')),
  refund_amount_cents integer NOT NULL DEFAULT 0 CHECK (refund_amount_cents >= 0),
  reason_code text NOT NULL,
  staff_note text CHECK (staff_note IS NULL OR char_length(staff_note) <= 1000),
  notify_customer boolean NOT NULL DEFAULT true,
  initiated_by_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 12 AND 120),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (order_id, idempotency_key)
);

CREATE TABLE app.order_cancellation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_cancellation_id uuid NOT NULL REFERENCES app.order_cancellations(id) ON DELETE CASCADE,
  fulfillment_group_id uuid NOT NULL REFERENCES app.order_fulfillment_groups(id) ON DELETE RESTRICT,
  external_order_id text,
  status text NOT NULL CHECK (status IN ('NOT_REQUIRED','REQUESTED','CANCELLED','UNAVAILABLE','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_error_code text,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_attempt_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_cancellation_id, fulfillment_group_id)
);

CREATE TABLE app.order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','CLOSED','REJECTED')),
  reason_code text NOT NULL,
  shipping_required boolean NOT NULL DEFAULT true,
  carrier text,
  tracking_number text,
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_by_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 12 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, idempotency_key)
);

CREATE TABLE app.order_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_return_id uuid NOT NULL REFERENCES app.order_returns(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES app.order_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  UNIQUE (order_return_id, order_item_id)
);

CREATE TABLE app.order_return_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_return_id uuid NOT NULL REFERENCES app.order_returns(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL CHECK (to_state IN ('REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','CLOSED','REJECTED')),
  actor_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 12 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.order_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  price_difference_cents integer NOT NULL,
  reason_code text NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_by_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 12 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, idempotency_key)
);
```

Alter `app.order_refunds` so exactly one initiator exists and both original-payment and Store Credit refunds are represented:

```sql
ALTER TABLE app.order_refunds
  ADD COLUMN destination text NOT NULL DEFAULT 'ORIGINAL_PAYMENT'
    CHECK (destination IN ('ORIGINAL_PAYMENT','STORE_CREDIT')),
  ADD COLUMN initiated_by_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  ADD COLUMN store_credit_ledger_entry_id uuid REFERENCES app.store_credit_ledger(id) ON DELETE RESTRICT,
  ALTER COLUMN initiated_by_user_id DROP NOT NULL,
  ALTER COLUMN provider DROP NOT NULL;

ALTER TABLE app.order_refunds
  ADD CONSTRAINT order_refunds_exactly_one_actor_check CHECK (
    (initiated_by_user_id IS NOT NULL AND initiated_by_staff_member_id IS NULL)
    OR
    (initiated_by_user_id IS NULL AND initiated_by_staff_member_id IS NOT NULL)
  ),
  ADD CONSTRAINT order_refunds_destination_backing_check CHECK (
    (
      destination = 'ORIGINAL_PAYMENT'
      AND payment_id IS NOT NULL
      AND store_credit_ledger_entry_id IS NULL
    )
    OR
    (
      destination = 'STORE_CREDIT'
      AND provider IS NULL
      AND (
        (status = 'PENDING' AND store_credit_ledger_entry_id IS NULL)
        OR (status = 'SUCCEEDED' AND store_credit_ledger_entry_id IS NOT NULL)
        OR status = 'FAILED'
      )
    )
  );
```

Add the actor constraint only after dropping the old `NOT NULL`; every legacy row already has `initiated_by_user_id` because migration 0014 required it, so no synthetic actor or data backfill is needed. Add these indexes: `(order_id, status, created_at DESC)` on cancellations, partial/failed cancellation groups by `updated_at`, `(order_id, state, created_at DESC)` on returns, and `(archived_at, created_at DESC)` on orders where `archived_at IS NOT NULL`.

- [ ] **Step 4: Update journal and required table inventory**

Append migration index 48/tag `0049_order_admin_actions` after 0048 and add all six tables to `requiredApplicationTables`.

- [ ] **Step 5: Run database unit tests and local migration verification**

Run: `pnpm test -- packages/db/src/required-tables.test.ts`  
Run: `$env:DATABASE_URL='postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'; pnpm db:migrate; pnpm db:verify`  
Expected: both commands pass and the new tables/columns exist.

- [ ] **Step 6: Commit the migration**

```powershell
git add -- packages/db/drizzle/0049_order_admin_actions.sql packages/db/drizzle/meta/_journal.json packages/db/src/required-tables.ts packages/db/src/required-tables.test.ts
git commit -m "feat: persist order admin actions"
```

---

### Task 3: Provider cancellation contract

**Files:**

- Modify: `packages/domain/src/fulfillment-contracts.ts`
- Modify: `packages/domain/src/fulfillment.ts`
- Modify: `packages/domain/src/printify.ts`
- Modify: `packages/domain/src/fulfillment.test.ts`
- Modify: `packages/domain/src/commerce.integration.test.ts`
- Modify: `packages/domain/src/fulfillment-routing.integration.test.ts`

**Interfaces:**

- Produces `FulfillmentCancellationResult` and `FulfillmentService.cancelOrder(input)`.
- Used by Task 6 cancellation orchestration.

- [ ] **Step 1: Write failing adapter contract tests**

```ts
await expect(
  fake.cancelOrder({ externalOrderId: 'provider-order-1', idempotencyKey: 'cancel-order-0001' }),
).resolves.toEqual({ state: 'CANCELLED' });
```

Test Printify success mapping, explicit provider rejection as `UNAVAILABLE`, timeout/unknown errors as typed `FulfillmentIntegrationError`, and duplicate idempotency behavior.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test -- packages/domain/src/fulfillment.test.ts`  
Expected: FAIL because `cancelOrder` is absent.

- [ ] **Step 3: Extend the fulfillment interface**

```ts
export interface FulfillmentCancellationResult {
  state: 'CANCELLED' | 'UNAVAILABLE';
  occurredAt: Date | null;
}

cancelOrder(input: {
  idempotencyKey: string;
  externalOrderId: string;
}): Promise<FulfillmentCancellationResult>;
```

The fake adapter returns deterministic success. The Printify adapter calls the provider cancellation endpoint through its existing authenticated request helper, maps a provider refusal to `UNAVAILABLE`, and normalizes network/timeout failures without claiming cancellation.

- [ ] **Step 4: Update every test fulfillment double explicitly**

Every `FulfillmentService` implementation must add a deterministic `cancelOrder` method; do not make the interface optional because cancellation capability is a platform contract.

- [ ] **Step 5: Run fulfillment and domain typechecks**

Run: `pnpm test -- packages/domain/src/fulfillment.test.ts packages/domain/src/commerce.integration.test.ts`  
Run: `pnpm --filter @let-it-be/domain typecheck`  
Expected: tests and typecheck pass.

- [ ] **Step 6: Commit the adapter contract**

```powershell
git add -- packages/domain/src/fulfillment-contracts.ts packages/domain/src/fulfillment.ts packages/domain/src/printify.ts packages/domain/src/fulfillment.test.ts packages/domain/src/commerce.integration.test.ts packages/domain/src/fulfillment-routing.integration.test.ts
git commit -m "feat: add fulfillment cancellation boundary"
```

---

### Task 4: Shared refund and Store Credit transaction primitives

**Files:**

- Create: `packages/domain/src/order-refunds.ts`
- Create: `packages/domain/src/order-refunds.test.ts`
- Modify: `packages/domain/src/operations-analytics.ts`
- Modify: `packages/domain/src/commerce.integration.test.ts`
- Modify: `packages/domain/src/store-credit.ts`
- Modify: `packages/domain/src/store-credit.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces `OrderRefundService.refundOriginalPayment(actor, input)` and `OrderRefundService.refundToStoreCredit(actor, input)`.
- Produces `adjustStoreCreditWithClient(client, actor, customerId, input)` for atomic composition.
- Preserves `CxOperationsService.refund()` by delegating to `OrderRefundService`.

- [ ] **Step 1: Write failing refund-engine tests**

Cover staff actors, customer actors, remaining-balance calculation using `PENDING` plus `SUCCEEDED`, duplicate keys, provider failure, Store Credit atomicity, and lack of implicit Return rows.

```ts
await service.refundToStoreCredit(staff, {
  orderNumber: '#1',
  amountCents: 1200,
  reasonCode: 'CUSTOMER_REQUEST',
  note: 'Approved by support',
  idempotencyKey: 'refund-store-credit-0001',
});
expect(executedSql).toContain('INSERT INTO app.store_credit_ledger');
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test -- packages/domain/src/order-refunds.test.ts packages/domain/src/store-credit.test.ts`  
Expected: FAIL because the shared engine and transactional helper do not exist.

- [ ] **Step 3: Extract original-payment refund logic**

Move reservation/provider/finalization logic from `CxOperationsService.refund` into `OrderRefundService`. Use an actor union:

```ts
type RefundActor =
  | { type: 'STAFF'; staffMemberId: string; role: 'OWNER' | 'OPERATIONS'; email: string }
  | { type: 'USER'; userId: string; email: string };

interface RefundOrderInput {
  orderNumber: string;
  amountCents: number;
  reasonCode: string;
  note?: string;
  idempotencyKey: string;
}

interface RefundOrderResult {
  refundId: string;
  destination: 'ORIGINAL_PAYMENT' | 'STORE_CREDIT';
  amountCents: number;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  duplicate: boolean;
}

class OrderRefundService {
  refundOriginalPayment(actor: RefundActor, input: RefundOrderInput): Promise<RefundOrderResult>;
  refundToStoreCredit(actor: RefundActor, input: RefundOrderInput): Promise<RefundOrderResult>;
}
```

Persist the matching initiator column and retain the existing provider idempotency key. Keep the public CX method behavior compatible by adapting its session to `RefundActor`.

- [ ] **Step 4: Extract Store Credit mutation into a client-aware primitive**

`StoreCreditService.adjust()` opens a transaction and delegates to `adjustStoreCreditWithClient`. `refundToStoreCredit()` uses the same helper inside the refund transaction and records `store_credit_ledger_entry_id` before completing the refund row.

- [ ] **Step 5: Run unit and PostgreSQL integration tests**

Run: `pnpm test -- packages/domain/src/order-refunds.test.ts packages/domain/src/store-credit.test.ts`  
Run: `$env:DATABASE_URL='postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'; pnpm test -- packages/domain/src/store-credit.integration.test.ts packages/domain/src/commerce.integration.test.ts`  
Expected: existing CX refunds and new staff/Store Credit refunds pass.

- [ ] **Step 6: Commit the shared monetary boundary**

```powershell
git add -- packages/domain/src/order-refunds.ts packages/domain/src/order-refunds.test.ts packages/domain/src/operations-analytics.ts packages/domain/src/commerce.integration.test.ts packages/domain/src/store-credit.ts packages/domain/src/store-credit.test.ts packages/domain/src/index.ts
git commit -m "feat: unify order refund operations"
```

---

### Task 5: Archive and Unarchive operations

**Files:**

- Create: `packages/domain/src/order-admin-actions.ts`
- Create: `packages/domain/src/order-admin-actions.test.ts`
- Create: `packages/domain/src/order-admin-actions.integration.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces `OrderAdminActionsService.archive(session, input)` and `.unarchive(session, input)`.
- Establishes shared order locking, role validation, idempotency lookup, audit insertion, and typed errors for later tasks.
- Consumes `AdminStaffSession` from `admin-commerce.ts`.

- [ ] **Step 1: Write failing archive tests**

```ts
await expect(
  service.archive(staff, {
    orderNumber: '#1',
    reasonCode: 'ORDER_COMPLETE',
    idempotencyKey: 'archive-order-0001',
  }),
).resolves.toMatchObject({ archived: true, duplicate: false });
```

Test fulfilled/delivered/cancelled eligibility, rejection for active unfulfilled order, read-only rejection, duplicate idempotency, Unarchive, and no mutation of order/payment/printing/fulfillment states.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test -- packages/domain/src/order-admin-actions.test.ts`  
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement shared service foundations and archive methods**

Use `withTransaction`, resolve the order by display number, lock with `FOR UPDATE`, query per-group Printing plus aggregate Fulfillment and refund balance, call `resolveOrderActionEligibility`, and write `order_operational_audits` with before/after archive metadata.

```ts
interface ArchiveOrderInput {
  orderNumber: string;
  reasonCode: string;
  note?: string;
  idempotencyKey: string;
}

interface ArchiveResult {
  orderId: string;
  archived: boolean;
  archivedAt: Date | null;
  duplicate: boolean;
}

async archive(session: AdminStaffSession, input: ArchiveOrderInput): Promise<ArchiveResult>
async unarchive(session: AdminStaffSession, input: ArchiveOrderInput): Promise<ArchiveResult>
```

- [ ] **Step 4: Add PostgreSQL integration coverage**

Create eligible and ineligible orders, archive/unarchive them, and assert only archive columns plus audit events change.

- [ ] **Step 5: Run unit and integration tests**

Run: `pnpm test -- packages/domain/src/order-admin-actions.test.ts`  
Run: `$env:DATABASE_URL='postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'; pnpm test -- packages/domain/src/order-admin-actions.integration.test.ts`  
Expected: all archive cases pass.

- [ ] **Step 6: Commit archive operations**

```powershell
git add -- packages/domain/src/order-admin-actions.ts packages/domain/src/order-admin-actions.test.ts packages/domain/src/order-admin-actions.integration.test.ts packages/domain/src/index.ts
git commit -m "feat: add order archive operations"
```

---

### Task 6: Cancellation orchestration

**Files:**

- Modify: `packages/domain/src/order-admin-actions.ts`
- Modify: `packages/domain/src/order-admin-actions.test.ts`
- Modify: `packages/domain/src/order-admin-actions.integration.test.ts`
- Modify: `packages/domain/src/order-operations.ts`
- Modify: `packages/domain/src/order-operations.test.ts`

**Interfaces:**

- Produces `OrderAdminActionsService.cancel(session, input)` and `.retryCancellation(session, input)`.
- Uses `FulfillmentService.cancelOrder`, `OrderRefundService`, and canonical order hold/cancel transitions.

```ts
interface CancelOrderInput {
  orderNumber: string;
  refundDestination: RefundDestination;
  refundAmountCents: number;
  reasonCode: string;
  staffNote?: string;
  notifyCustomer: boolean;
  idempotencyKey: string;
}

interface CancelOrderResult {
  cancellationId: string;
  status: CancellationStatus;
  orderStatus: string;
  unresolvedFulfillmentGroupIds: string[];
  duplicate: boolean;
}

cancel(session: AdminStaffSession, input: CancelOrderInput): Promise<CancelOrderResult>;
retryCancellation(
  session: AdminStaffSession,
  input: { orderNumber: string; cancellationId: string; idempotencyKey: string },
): Promise<CancelOrderResult>;
```

- [ ] **Step 1: Write failing cancellation tests**

Cover unfulfilled/not-started success, fulfilled rejection, `IN_PRODUCTION` rejection, `PRINTED` rejection, submitted provider success, provider refusal, provider timeout, refund-later, original-method refund, Store Credit refund, notification intent, and duplicate idempotency.

Add a two-provider case where group A cancels and group B fails:

```ts
expect(result.status).toBe('PARTIAL');
expect(result.orderStatus).toBe('ON_HOLD');
expect(cancelOrder).toHaveBeenCalledTimes(2);
```

Retry must call only unresolved groups.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test -- packages/domain/src/order-admin-actions.test.ts packages/domain/src/order-operations.test.ts`  
Expected: FAIL because cancellation orchestration is absent.

- [ ] **Step 3: Implement reservation and provider phase**

Inside a transaction, lock the order, recompute eligibility, insert/reuse `order_cancellations`, and create one group-attempt row per fulfillment group. Outside the transaction, cancel only groups with external provider orders and unresolved attempts. Groups without an external order become `NOT_REQUIRED`.

- [ ] **Step 4: Implement finalization phase**

Re-lock the order and cancellation aggregate. If every required group succeeded, invoke the canonical cancellation transition and then execute the selected refund destination. If some succeeded and some failed/unknown, mark `PARTIAL` and invoke the existing authoritative hold transition. If none succeeded, mark `FAILED` and preserve the active order state.

- [ ] **Step 5: Persist lifecycle notification intent**

When `notifyCustomer` is true, commit an idempotent `lifecycle_deliveries` outbox row in the same business transaction using the customer's persisted notification language in its payload. Dispatch through the configured adapter only after commit; local development uses the fake adapter. Delivery failure updates the delivery row and timeline but never rolls back cancellation.

- [ ] **Step 6: Run unit and integration tests**

Run: `pnpm test -- packages/domain/src/order-admin-actions.test.ts packages/domain/src/order-operations.test.ts`  
Run: `$env:DATABASE_URL='postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'; pnpm test -- packages/domain/src/order-admin-actions.integration.test.ts`  
Expected: full, failed, partial, retried, and duplicate cancellation cases pass.

- [ ] **Step 7: Commit cancellation**

```powershell
git add -- packages/domain/src/order-admin-actions.ts packages/domain/src/order-admin-actions.test.ts packages/domain/src/order-admin-actions.integration.test.ts packages/domain/src/order-operations.ts packages/domain/src/order-operations.test.ts
git commit -m "feat: add safe order cancellation"
```

---

### Task 7: Independent Return workflow

**Files:**

- Modify: `packages/domain/src/order-admin-actions.ts`
- Modify: `packages/domain/src/order-admin-actions.test.ts`
- Modify: `packages/domain/src/order-admin-actions.integration.test.ts`

**Interfaces:**

- Produces `.createReturn(session, input)` and `.transitionReturn(session, input)`.
- Produces `OrderReturnSummary` for the Order Detail read model.

```ts
interface CreateReturnInput {
  orderNumber: string;
  items: Array<{ orderItemId: string; quantity: number }>;
  reasonCode: string;
  shippingRequired: boolean;
  note?: string;
  idempotencyKey: string;
}

interface TransitionReturnInput {
  orderNumber: string;
  returnId: string;
  toState: ReturnState;
  carrier?: string;
  trackingNumber?: string;
  note?: string;
  idempotencyKey: string;
}

interface OrderReturnSummary {
  id: string;
  state: ReturnState;
  items: Array<{ orderItemId: string; quantity: number }>;
  reasonCode: string;
  shippingRequired: boolean;
  carrier: string | null;
  trackingNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

createReturn(session: AdminStaffSession, input: CreateReturnInput): Promise<OrderReturnSummary>;
transitionReturn(session: AdminStaffSession, input: TransitionReturnInput): Promise<OrderReturnSummary>;
```

- [ ] **Step 1: Write failing Return tests**

Test fulfilled quantity eligibility, unfulfilled rejection, quantity above remaining returnable amount, multiple partial returns, all six allowed transitions, invalid transition rejection, duplicate idempotency, staff actor persistence, and zero calls to payment/refund/Store Credit services.

```ts
await service.createReturn(staff, {
  orderNumber: '#1',
  items: [{ orderItemId, quantity: 1 }],
  reasonCode: 'SIZE_OR_FIT',
  shippingRequired: true,
  note: 'Awaiting carrier scan',
  idempotencyKey: 'return-order-item-0001',
});
expect(refundOriginalPayment).not.toHaveBeenCalled();
expect(refundToStoreCredit).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test -- packages/domain/src/order-admin-actions.test.ts`  
Expected: FAIL because Return methods are absent.

- [ ] **Step 3: Implement Return creation under order lock**

Query fulfilled quantities per item, subtract non-rejected prior return quantities, reject excess, insert the aggregate/items plus initial `REQUESTED` event, and write an operational audit.

- [ ] **Step 4: Implement explicit transition graph**

```ts
const returnTransitions = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['IN_TRANSIT', 'REJECTED'],
  IN_TRANSIT: ['RECEIVED'],
  RECEIVED: ['CLOSED'],
  CLOSED: [],
  REJECTED: [],
} as const;
```

Lock the return row, validate the target, append `order_return_events`, and update the aggregate state atomically.

- [ ] **Step 5: Run unit and integration tests**

Run: `pnpm test -- packages/domain/src/order-admin-actions.test.ts`  
Run: `$env:DATABASE_URL='postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'; pnpm test -- packages/domain/src/order-admin-actions.integration.test.ts`  
Expected: Return workflow passes without monetary side effects.

- [ ] **Step 6: Commit Return workflow**

```powershell
git add -- packages/domain/src/order-admin-actions.ts packages/domain/src/order-admin-actions.test.ts packages/domain/src/order-admin-actions.integration.test.ts
git commit -m "feat: add independent order returns"
```

---

### Task 8: Edit order revisions and payment differences

**Files:**

- Modify: `packages/domain/src/order-admin-actions.ts`
- Modify: `packages/domain/src/order-admin-actions.test.ts`
- Modify: `packages/domain/src/order-admin-actions.integration.test.ts`
- Modify: `packages/domain/src/commerce.ts`
- Modify: `packages/domain/src/commerce.integration.test.ts`

**Interfaces:**

- Produces `.editOrder(session, input)` returning revision ID, signed price difference, amount due, refundable adjustment, and current eligibility.
- Reuses server-owned pricing/tax/variant validation from `CommerceService` through a new exported `OrderRepricingService` rather than duplicating checkout math.
- Consumes existing `ShippingAddressInput`, `PricingSnapshot`, and `TaxSnapshot` from `commerce.ts`.

```ts
interface EditOrderInput {
  orderNumber: string;
  items?: Array<{ orderItemId?: string; productVariantId: string; quantity: number }>;
  discountCents?: number;
  shippingCents?: number;
  shippingAddress?: ShippingAddressInput;
  customerEmail?: string;
  customerPhone?: string;
  note?: string;
  tags?: string[];
  reasonCode: string;
  idempotencyKey: string;
}

interface EditOrderResult {
  revisionId: string;
  priceDifferenceCents: number;
  amountDueCents: number;
  refundableAdjustmentCents: number;
  eligibility: OrderActionEligibility;
  duplicate: boolean;
}

editOrder(session: AdminStaffSession, input: EditOrderInput): Promise<EditOrderResult>;
```

- [ ] **Step 1: Write failing repricing and edit tests**

Cover contact-only edits, pre-production item/quantity/variant changes, locked production fields, locked shipped address, invalid variants, tax recalculation from the shipping destination, negative difference, positive difference, amount-due hold, idempotency, before/after snapshots, and unchanged external fulfillment history.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test -- packages/domain/src/order-admin-actions.test.ts packages/domain/src/commerce.integration.test.ts`  
Expected: FAIL because repricing and edit methods are absent.

- [ ] **Step 3: Extract server-owned repricing service**

Expose a focused service that validates variants and returns a complete replacement commercial snapshot:

```ts
interface RepriceOrderInput {
  items: Array<{ orderItemId?: string; productVariantId: string; quantity: number }>;
  discountCents: number;
  shippingCents: number;
  shippingAddress: ShippingAddressInput;
}

class OrderRepricingService {
  reprice(input: RepriceOrderInput): Promise<{ pricing: PricingSnapshot; tax: TaxSnapshot }>;
}
```

Checkout and admin editing must call the same pricing/tax primitives.

- [ ] **Step 4: Implement transactional order revision**

Lock order/items/groups, recompute field eligibility, validate the proposed snapshot, insert `order_revisions`, update current item/commercial snapshots, and set:

```ts
amountDueCents = Math.max(0, newTotalCents - effectivePaidCents);
refundableAdjustmentCents = Math.max(0, effectivePaidCents - newTotalCents);
```

If amount due becomes positive, invoke an authoritative operational hold. Do not rewrite payments, refunds, printing events, shipment history, or provider order identifiers.

- [ ] **Step 5: Invalidate and rebuild only unsubmitted fulfillment planning**

For item/variant changes before provider submission, replace unsubmitted fulfillment-group planning from the new items and rerun readiness/routing. Never alter a group with an external order or `IN_PRODUCTION`/`PRINTED` state.

- [ ] **Step 6: Run unit and integration tests**

Run: `pnpm test -- packages/domain/src/order-admin-actions.test.ts`  
Run: `$env:DATABASE_URL='postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'; pnpm test -- packages/domain/src/order-admin-actions.integration.test.ts packages/domain/src/commerce.integration.test.ts`  
Expected: edits preserve immutable operational history and calculate balances correctly.

- [ ] **Step 7: Commit Edit order**

```powershell
git add -- packages/domain/src/order-admin-actions.ts packages/domain/src/order-admin-actions.test.ts packages/domain/src/order-admin-actions.integration.test.ts packages/domain/src/commerce.ts packages/domain/src/commerce.integration.test.ts
git commit -m "feat: add guarded order editing"
```

---

### Task 9: Order Detail read model and timeline integration

**Files:**

- Modify: `packages/domain/src/order-detail.ts`
- Modify: `packages/domain/src/order-detail.test.ts`
- Modify: `packages/domain/src/order-detail.integration.test.ts`
- Modify: `apps/web/app/admin/orders/[orderNumber]/order-detail-types.ts`

**Interfaces:**

- Extends `AdminOrderDetail` with `eligibility`, `archived`, `amountDueCents`, `refundableCents`, `returns`, and cancellation summary.
- Extends the existing ten-entry grouped timeline with action events.

- [ ] **Step 1: Write failing read-model tests**

Assert persisted archive actor/time, calculated refundable balance, amount due, remaining returnable quantities, current Return states, cancellation status, and action eligibility. Add timeline assertions for Edit, Cancel, provider cancel result, Refund, Return transitions, Archive, Unarchive, and notification state.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test -- packages/domain/src/order-detail.test.ts packages/domain/src/order-detail.integration.test.ts`  
Expected: FAIL because the read model does not expose action data.

- [ ] **Step 3: Extend Order Detail aggregation**

Load the new aggregates in parallel with groups/items/notes/tags, calculate effective paid/refunded/refundable amounts from persisted ledgers, and call the pure eligibility resolver with current aggregate states.

- [ ] **Step 4: Extend the timeline SQL union**

Map every new table/event to stable IDs such as `cancellation:{id}`, `refund:{id}`, `return-event:{id}`, and `revision:{id}`. Include actor, amount/item details, reason, and result while preserving `ORDER BY occurred_at DESC, id DESC`, limit 10, date grouping, and internal pagination.

- [ ] **Step 5: Run read-model tests and typecheck**

Run: `pnpm test -- packages/domain/src/order-detail.test.ts packages/domain/src/order-detail.integration.test.ts`  
Run: `pnpm --filter @let-it-be/domain typecheck`  
Expected: all read-model and timeline cases pass.

- [ ] **Step 6: Commit read-model integration**

```powershell
git add -- packages/domain/src/order-detail.ts packages/domain/src/order-detail.test.ts packages/domain/src/order-detail.integration.test.ts apps/web/app/admin/orders/[orderNumber]/order-detail-types.ts
git commit -m "feat: expose order action history"
```

---

### Task 10: Admin APIs and runtime wiring

**Files:**

- Create: `apps/web/app/api/admin/orders/[orderNumber]/edits/route.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/edits/route.test.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/cancellations/route.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/cancellations/route.test.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/refunds/route.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/refunds/route.test.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/returns/route.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/returns/route.test.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/returns/[returnId]/transitions/route.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/returns/[returnId]/transitions/route.test.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/archive/route.ts`
- Create: `apps/web/app/api/admin/orders/[orderNumber]/archive/route.test.ts`
- Modify: `apps/web/lib/platform.ts`
- Modify: `apps/web/lib/http.ts`

**Interfaces:**

- Produces exact APIs defined by the spec.
- Produces `orderAdminActionsRuntime()` wired to database, payment, fulfillment, refund, Store Credit, order operations, and lifecycle dependencies.

- [ ] **Step 1: Write failing route tests**

For every route, test admin authentication, Owner/Operations success, read-only 403, malformed body 400, stale/ineligible state 409, missing order 404, exact input forwarding, idempotency forwarding, and typed provider failure. Test both POST Archive and DELETE Unarchive.

- [ ] **Step 2: Run route tests and verify RED**

Run: `pnpm test -- apps/web/app/api/admin/orders/[orderNumber]`  
Expected: new route test files fail because routes are absent.

- [ ] **Step 3: Implement strict request parsing**

Each route decodes the display order number through `decodeOrderNumberRouteParam`, requires the admin session, validates enums/UUIDs/positive integer quantities/minor units/note limits, and rejects unknown action fields. Accept `Idempotency-Key` header and reject keys outside 12–120 characters.

- [ ] **Step 4: Add runtime factory and error mappings**

Instantiate `OrderAdminActionsService` with the same configured payment and fulfillment adapters used elsewhere. Map validation to 400, access to 403, not-found to 404, and state conflicts/provider refusal to 409 without exposing provider secrets or raw payloads.

- [ ] **Step 5: Run routes and web typecheck**

Run: `pnpm test -- apps/web/app/api/admin/orders/[orderNumber]`  
Run: `pnpm --filter @let-it-be/web typecheck`  
Expected: routes pass and compile.

- [ ] **Step 6: Commit the APIs**

```powershell
git add -- apps/web/app/api/admin/orders/[orderNumber] apps/web/lib/platform.ts apps/web/lib/http.ts
git commit -m "feat: expose order admin action APIs"
```

---

### Task 11: Context-aware menu and focused modals

**Files:**

- Create: `apps/web/app/admin/orders/[orderNumber]/order-actions-menu.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/order-action-client.ts`
- Create: `apps/web/app/admin/orders/[orderNumber]/cancel-order-modal.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/refund-order-modal.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/return-order-modal.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/edit-order-modal.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/archive-order-modal.tsx`
- Create: `apps/web/app/admin/orders/[orderNumber]/order-actions-ui.test.ts`
- Modify: `apps/web/app/admin/orders/[orderNumber]/admin-order-detail.tsx`
- Modify: `apps/web/app/admin/orders/[orderNumber]/order-payment-summary.tsx`
- Modify: `apps/web/app/admin/orders/[orderNumber]/order-fulfillment-group.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- `OrderActionsMenu` renders only server-returned eligible actions.
- `submitOrderAction(path, body)` generates/reuses one idempotency key per modal submission and returns typed errors.
- Each modal owns only its form state and delegates mutations to the shared client.

- [ ] **Step 1: Write failing UI contract tests**

Assert menu visibility per eligibility, absence for read-only users, Cancel without Restock, Cancel refund destinations, Refund remaining-balance display and confirmation, Return without refund controls, Edit locked-field explanations, Archive/Unarchive labels, modal error retention, and refresh callback after success.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `pnpm test -- apps/web/app/admin/orders/[orderNumber]/order-actions-ui.test.ts`  
Expected: FAIL because components do not exist.

- [ ] **Step 3: Build the shared menu and client**

Render a Shopify-like `More actions` popover near the order header. Close on outside click and Escape, restore focus after modal close, use semantic buttons, and never infer eligibility from labels or browser state.

- [ ] **Step 4: Build Cancel and Refund modals**

Cancel displays refundable amount, Original payment/Store Credit/Refund later, reason, note, and Notify customer. Refund displays item quantity aids, shipping/custom amount, destination, reason, note, live remaining balance, and a separate final confirmation view.

- [ ] **Step 5: Build Return, Edit, and Archive modals**

Return shows only returnable fulfilled quantities and logistics fields. Edit renders allowed fields and disabled explanations from `editFields`. Archive/Unarchive uses a compact confirmation. Every modal disables duplicate submit and retains server validation messages.

- [ ] **Step 6: Add contextual Refund and Return entry points**

Payment and fulfillment sections may open the same modal instances; they must not duplicate mutation logic. Hide Return when no returnable quantity and Refund when remaining refundable balance is zero.

- [ ] **Step 7: Style and run UI tests**

Use existing admin card, popover, modal, focus-ring, badge, and spacing tokens. Verify desktop layout first and ensure the dialog remains usable at narrow widths.

Run: `pnpm test -- apps/web/app/admin/orders/[orderNumber]`  
Run: `pnpm --filter @let-it-be/web typecheck`  
Expected: all Order Detail component tests pass.

- [ ] **Step 8: Commit the UI**

```powershell
git add -- apps/web/app/admin/orders/[orderNumber] apps/web/app/globals.css
git commit -m "feat: add order action modals"
```

---

### Task 12: Full verification and operational handoff

**Files:**

- Modify only files required by failures attributable to Order Admin Actions.

**Interfaces:**

- Consumes all prior tasks.
- Produces a verified local implementation without claiming real provider actions that were not exercised.

- [ ] **Step 1: Re-read the spec and audit the diff**

Match every spec section to Tasks 1–11. Run:

```powershell
git diff --check
git status --short
```

Confirm prior uncommitted Orders directory/detail work remains intact and unrelated files were not reverted.

- [ ] **Step 2: Run the full automated gate**

```powershell
pnpm format
pnpm lint
pnpm typecheck
pnpm test
$env:DATABASE_URL='postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'; pnpm test:integration
pnpm build
```

Expected: every command exits 0. Record exact test counts and the existing Next.js middleware deprecation warning separately.

- [ ] **Step 3: Verify eligible and ineligible browser states**

At `/admin/orders/[orderNumber]`, exercise:

- unfulfilled/not-started: Edit, Cancel, Refund; no Return/Archive;
- in-production unfulfilled: no Cancel and locked production edit fields;
- delivered: Return, Refund, Archive; no Cancel;
- archived: Unarchive only instead of Archive;
- partial refund: reduced remaining refundable balance;
- full refund: no Refund action;
- Return creation and transitions without payment changes;
- Cancel refund-later, Original payment, and Store Credit using local adapters;
- multi-provider partial cancellation and unresolved-group retry;
- stale modal 409 behavior;
- timeline date grouping, ten-entry pagination, actor/reason/amount/item details;
- outside-click/Escape closing, focus restoration, and keyboard navigation.

- [ ] **Step 4: Verify persistence directly**

Query the local development database for the exercised order and confirm cancellation groups, refund ledger, Store Credit ledger, return items/events, order revisions, archive metadata, lifecycle deliveries, and operational audits correspond exactly to browser actions.

- [ ] **Step 5: Report environment boundaries**

State separately whether each was exercised with Fake/local or real adapters:

- payment refund;
- provider cancellation;
- Store Credit;
- lifecycle email delivery.

Do not report a real provider, real payment, or real email PASS unless the configured external service actually executed it.

- [ ] **Step 6: Re-run the complete gate after any verification fix**

If browser or persistence verification changes a Task 1–11 file, add a regression test to that task's listed test file, rerun the focused test plus every command from Step 2, and commit only the exact changed files under `fix: harden order admin actions`.
