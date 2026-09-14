# Order Net Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Shopify-style `Paid`, `Refunded`, and `Net payment` settlement rows using persisted refund-ledger data.

**Architecture:** Extend the existing order-detail read model with a sanitized list of completed refunds, queried beside pending refunds. Keep aggregate monetary authority in `financials.refundedCents`, and use the completed rows only to describe refund destinations and reasons in the React payment summary.

**Tech Stack:** TypeScript, PostgreSQL, React, Next.js, Vitest

**Spec:** `docs/superpowers/specs/2026-09-14-order-net-payment-design.md`

## Global Constraints

- `Total` remains the immutable order value.
- `Net payment` equals `paidCents - refundedCents` and appears only after at least one completed refund.
- Pending and failed refunds do not reduce `Net payment`.
- Refund destination and reason come from persisted `app.order_refunds` rows, never from order status.
- No refund mutation, payment-processing, or timeline behavior changes.

---

### Task 1: Project completed refund ledger metadata

**Files:**

- Modify: `packages/domain/src/order-detail.ts`
- Modify: `packages/domain/src/order-detail.integration.test.ts`

**Interfaces:**

- Produces: `AdminOrderCompletedRefund` with `id`, `destination`, `amountCents`, `reasonCode`, and `completedAt`.
- Produces: `AdminOrderDetail.completedRefunds: AdminOrderCompletedRefund[]`.
- Consumes: persisted `app.order_refunds` rows whose status is `SUCCEEDED`.

- [ ] **Step 1: Write the failing integration assertion**

Extend the existing `projects persisted action balances...` integration case so its successful original-payment refund has an explicit `destination='ORIGINAL_PAYMENT'`, `reason_code='ORDER_CANCELLED'`, and `completed_at`. Insert a second successful store-credit refund and assert:

```ts
expect(detail?.completedRefunds).toEqual([
  expect.objectContaining({
    destination: 'STORE_CREDIT',
    amountCents: 250,
    reasonCode: 'CUSTOMER_REQUEST',
    completedAt: expect.any(Date),
  }),
  expect.objectContaining({
    destination: 'ORIGINAL_PAYMENT',
    amountCents: 1000,
    reasonCode: 'ORDER_CANCELLED',
    completedAt: expect.any(Date),
  }),
]);
```

Update the existing balance expectation to include the additional successful $2.50 refund while leaving the pending reservation unchanged. Keep the current assertion proving provider IDs, payment IDs, and idempotency keys are not serialized.

- [ ] **Step 2: Run the focused integration test and verify RED**

Run:

```powershell
$env:DATABASE_URL='postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'; pnpm test -- packages/domain/src/order-detail.integration.test.ts
```

Expected: FAIL because `completedRefunds` is absent.

- [ ] **Step 3: Add the minimal domain projection**

Add:

```ts
export interface AdminOrderCompletedRefund {
  id: string;
  destination: Exclude<RefundDestination, 'LATER'>;
  amountCents: number;
  reasonCode: string;
  completedAt: Date;
}
```

Add `completedRefunds` to `AdminOrderDetail`, issue one parameterized query within the existing `Promise.all`, and return its rows:

```sql
SELECT id,destination,amount_cents AS "amountCents",reason_code AS "reasonCode",
       completed_at AS "completedAt"
FROM app.order_refunds
WHERE order_id=$1 AND status='SUCCEEDED'
  AND destination IN ('ORIGINAL_PAYMENT','STORE_CREDIT')
ORDER BY completed_at DESC NULLS LAST,id DESC
```

Do not select provider references, payment IDs, staff IDs, notes, or idempotency keys.

- [ ] **Step 4: Run the focused integration test and verify GREEN**

Run the command from Step 2.

Expected: PASS with the completed rows in deterministic order.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- packages/domain/src/order-detail.ts packages/domain/src/order-detail.integration.test.ts
git commit -m "feat: project completed order refunds"
```

### Task 2: Render the Shopify-style settlement summary

**Files:**

- Modify: `apps/web/app/admin/orders/[orderNumber]/order-detail-types.ts`
- Modify: `apps/web/app/admin/orders/[orderNumber]/order-payment-summary.tsx`
- Modify: `apps/web/app/admin/orders/[orderNumber]/order-detail-components.test.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- Consumes: `OrderDetail.completedRefunds` serialized by Task 1 with ISO-string `completedAt` values.
- Produces: `formatRefundDetail(order): string` for a readable persisted destination/reason summary.
- Produces: `Net payment` UI row calculated from aggregate `paidCents - refundedCents`.

- [ ] **Step 1: Write failing component tests**

Add one partial-refund fixture with:

```ts
completedRefunds: [
  {
    id: 'refund-1',
    destination: 'ORIGINAL_PAYMENT',
    amountCents: 2000,
    reasonCode: 'ORDER_CANCELLED',
    completedAt: '2026-09-14T12:00:00.000Z',
  },
],
```

Assert the rendered sequence includes:

```ts
expect(markup).toContain(
  '<dt>Refunded</dt><dd>Credit card · Reason: “Order cancelled”</dd><dd>−$20.00</dd>',
);
expect(markup).toContain('<dt>Net payment</dt><dd></dd><dd>$28.99</dd>');
```

Add a fully refunded mixed-destination fixture and assert `Credit card + Store credit`, `2 refunds`, and a `$0.00` net payment. Keep a pending-only fixture and assert it has `Pending refund` but no `Net payment`.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```powershell
pnpm test -- apps/web/app/admin/orders/[orderNumber]/order-detail-components.test.ts
```

Expected: FAIL because the type and Shopify-style settlement rows do not exist.

- [ ] **Step 3: Extend the browser-safe order type**

Add to `OrderDetail`:

```ts
completedRefunds: Array<{
  id: string;
  destination: 'ORIGINAL_PAYMENT' | 'STORE_CREDIT';
  amountCents: number;
  reasonCode: string;
  completedAt: string;
}>;
```

- [ ] **Step 4: Implement persisted refund-detail formatting**

In `order-payment-summary.tsx`, normalize reason codes without inventing business state:

```ts
function formatReasonCode(value: string): string {
  const words = value.trim().toLowerCase().replaceAll('_', ' ');
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : 'Reason unavailable';
}
```

Build the destination labels from unique completed destinations. Map `ORIGINAL_PAYMENT` to `financials.paymentMethod ?? 'Original payment method'` and `STORE_CREDIT` to `Store credit`. When all completed refunds share one reason, append ` · Reason: “<label>”`; otherwise append ` · <N> refunds`.

- [ ] **Step 5: Add the settlement rows and restrained hierarchy**

Replace the empty middle `Refunded` cell with the formatted detail. Immediately after it render:

```tsx
<div className="order-payment-net">
  <dt>Net payment</dt>
  <dd />
  <dd>{money.format((order.financials.paidCents - order.financials.refundedCents) / 100)}</dd>
</div>
```

Render both rows only when `refundedCents > 0`. Add a subtle top border and stronger weight to `.order-payment-net`, matching the existing `Total` hierarchy without introducing a new color.

- [ ] **Step 6: Run focused UI and domain unit tests**

Run:

```powershell
pnpm test -- apps/web/app/admin/orders/[orderNumber]/order-detail-components.test.ts packages/domain/src/order-detail.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- apps/web/app/admin/orders/[orderNumber]/order-detail-types.ts apps/web/app/admin/orders/[orderNumber]/order-payment-summary.tsx apps/web/app/admin/orders/[orderNumber]/order-detail-components.test.ts apps/web/app/globals.css
git commit -m "feat: show order net payment after refunds"
```

### Task 3: Verify the complete change

**Files:**

- Verify only; no expected source changes.

**Interfaces:**

- Consumes: Tasks 1 and 2.
- Produces: release evidence for the updated order financial summary.

- [ ] **Step 1: Inspect an actual refunded order in the desktop admin**

Open a refunded order and verify `Total`, `Paid`, `Refunded`, and `Net payment` appear in that order. Confirm the refund detail matches the ledger destination/reason and a full refund shows `$0.00`.

- [ ] **Step 2: Run repository verification**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: every command exits 0; skipped integration tests remain reported as skipped rather than failures.

- [ ] **Step 3: Confirm the worktree contains no uncommitted implementation files**

```powershell
git status --short
```

Expected: empty output.
