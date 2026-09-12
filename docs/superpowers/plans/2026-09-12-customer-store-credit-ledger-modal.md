# Customer Store Credit Ledger Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show accurate Store Credit history state on the customer detail card and provide a paginated ledger modal without navigating away from the CDP.

**Architecture:** Add typed Store Credit history metadata and a paginated ledger query to `CustomerOperationsService`, expose the query through an authenticated nested admin API route, and render a focused client modal from the existing customer detail client. Keep balance adjustment and history viewing as independent controls while reusing the existing admin modal language and accessibility behavior.

**Tech Stack:** TypeScript, React 19, Next.js App Router, PostgreSQL, Vitest, CSS.

**Spec:** `docs/superpowers/specs/2026-09-12-customer-store-credit-ledger-modal-design.md`

## Global Constraints

- No ledger transactions renders `-` and no chevron.
- Any ledger history renders a chevron and a formatted USD balance, including `$0.00 USD`.
- History presence comes from `app.store_credit_ledger`, not from the current balance.
- Ledger pages contain 20 entries ordered by `created_at DESC, id DESC`.
- The adjustment pencil and existing Store Credit adjustment workflow remain independent.
- The modal stays on the CDP and supports close button, backdrop, Escape, loading, error, retry, and pagination states.

---

### Task 1: Domain Store Credit history contracts and queries

**Files:**
- Modify: `packages/domain/src/customer-operations.ts`
- Modify: `packages/domain/src/customer-operations.test.ts`
- Modify: `packages/domain/src/store-credit.integration.test.ts`

**Interfaces:**
- Produces: `OperationsStoreCreditLedger`, `StoreCreditLedgerOptions`, `CustomerOperationsService.listStoreCreditLedger(session, customerId, options)`.
- Extends: `OperationsCustomerDetail.storeCreditTransactionCount: number`.

- [ ] **Step 1: Write failing unit tests for detail history count and ledger pagination SQL**

Add expectations that `getCustomer()` maps `store_credit_transaction_count`, and that `listStoreCreditLedger()` validates `page`/`limit`, requires read access, orders deterministically, and returns mapped entries:

```ts
expect(detail.storeCreditTransactionCount).toBe(2);
expect(result).toEqual({
  balanceCents: 0,
  currency: 'USD',
  total: 2,
  page: 1,
  limit: 20,
  entries: expect.arrayContaining([
    expect.objectContaining({ entryType: 'DEBIT', amountCents: 2500, balanceAfterCents: 0 }),
  ]),
});
```

- [ ] **Step 2: Run the focused unit test and verify the expected missing-field/missing-method failure**

Run: `pnpm test -- packages/domain/src/customer-operations.test.ts`

- [ ] **Step 3: Add the typed contract and minimal SQL implementation**

Use these public shapes:

```ts
export interface OperationsStoreCreditLedger {
  balanceCents: number;
  currency: 'USD';
  total: number;
  page: number;
  limit: number;
  entries: Array<{
    id: string;
    entryType: 'CREDIT' | 'DEBIT';
    amountCents: number;
    balanceAfterCents: number;
    reason: 'REFUND' | 'PROMOTION' | 'CUSTOMER_SERVICE' | 'OTHER';
    note: string | null;
    actorLabel: string;
    createdAt: Date;
  }>;
}

export interface StoreCreditLedgerOptions { page?: number; limit?: number }
```

Count ledger entries in the customer identity projection for the card and query the dedicated ledger with `LIMIT`/`OFFSET`, a total count, customer scoping, and `ORDER BY ledger.created_at DESC, ledger.id DESC`.

- [ ] **Step 4: Add integration coverage for no account, historical zero balance, and multiple entries**

Assert that a customer with no ledger returns `total: 0`, while a CREDIT followed by an equal DEBIT returns `balanceCents: 0`, `total: 2`, and both authoritative balances.

- [ ] **Step 5: Run focused domain tests**

Run: `pnpm test -- packages/domain/src/customer-operations.test.ts packages/domain/src/store-credit.integration.test.ts`

### Task 2: Authenticated Store Credit ledger API

**Files:**
- Create: `apps/web/app/api/admin/customers/[customerId]/store-credit-ledger/route.ts`
- Create: `apps/web/app/api/admin/customers/[customerId]/store-credit-ledger/route.test.ts`

**Interfaces:**
- Consumes: `CustomerOperationsService.listStoreCreditLedger(session, customerId, { page, limit })`.
- Produces: `GET /api/admin/customers/:customerId/store-credit-ledger?page=1&limit=20` returning `{ ledger }`.

- [ ] **Step 1: Write failing route tests**

Cover authenticated delegation, default paging, explicit paging, authentication failure, unknown customer, and invalid paging:

```ts
expect(customerOperationsRuntime().listStoreCreditLedger).toHaveBeenCalledWith(session, id, {
  page: 2,
  limit: 20,
});
```

- [ ] **Step 2: Run the route test and verify the missing-module failure**

Run: `pnpm test -- apps/web/app/api/admin/customers/[customerId]/store-credit-ledger/route.test.ts`

- [ ] **Step 3: Implement the minimal force-dynamic GET route**

Parse `page` and `limit` as numbers, call `requireAdminSession()`, delegate to the customer operations runtime, and pass failures to `handleRouteError()`.

- [ ] **Step 4: Run the route tests and verify they pass**

Run: `pnpm test -- apps/web/app/api/admin/customers/[customerId]/store-credit-ledger/route.test.ts`

### Task 3: Store Credit card state and ledger modal

**Files:**
- Modify: `apps/web/app/admin/customers/_components/customer-types.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-sidebar.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-client.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-sidebar.test.ts`
- Create: `apps/web/app/admin/customers/_components/store-credit-ledger-modal.tsx`
- Create: `apps/web/app/admin/customers/_components/store-credit-ledger.ts`
- Create: `apps/web/app/admin/customers/_components/store-credit-ledger.test.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `CustomerDetail.storeCreditTransactionCount` and the nested ledger endpoint.
- Produces: `StoreCreditLedgerModal({ customer, onAdjust, onClose })` plus `loadStoreCreditLedger(customerId, page, signal?)`.

- [ ] **Step 1: Write failing card rendering tests**

Assert these exact states:

```ts
expect(renderSidebar({ ...customer, storeCreditTransactionCount: 0 })).toContain('>-</p>');
expect(renderSidebar({ ...customer, storeCreditTransactionCount: 0 })).not.toContain('View store credit activity');
expect(renderSidebar({ ...customer, storeCreditBalanceCents: 0, storeCreditTransactionCount: 2 }))
  .toContain('$0.00 USD');
expect(renderSidebar({ ...customer, storeCreditTransactionCount: 2 }))
  .toContain('aria-label="View store credit activity"');
```

- [ ] **Step 2: Write failing loader and modal static-state tests**

Test the requested URL, payload/error mapping, balance header, debit/credit columns, reason/note/actor details, and pagination labels using real helper behavior and static React markup.

- [ ] **Step 3: Run focused web tests and verify failures are caused by missing behavior**

Run: `pnpm test -- apps/web/app/admin/customers/_components/customer-detail-sidebar.test.ts apps/web/app/admin/customers/_components/store-credit-ledger.test.ts`

- [ ] **Step 4: Implement card state and independent chevron action**

Add a `storeCreditLedger` sidebar action. Render the value and chevron in a separate flex row so clicking the pencil only opens adjustment and clicking the chevron only opens history.

- [ ] **Step 5: Implement the modal and loader**

Fetch page 1 when the modal opens, cancel stale requests, display retryable errors, trap focus, lock body scroll, dismiss on backdrop/Escape, and provide Previous/Next controls. `Adjust balance` closes the ledger modal and opens the existing adjustment modal.

- [ ] **Step 6: Add restrained responsive styling**

Use the existing card and modal tokens. Keep the balance summary compact, allow the ledger table to scroll horizontally only inside the modal on narrow screens, and preserve visible keyboard focus.

- [ ] **Step 7: Run focused web tests and verify they pass**

Run: `pnpm test -- apps/web/app/admin/customers/_components/customer-detail-sidebar.test.ts apps/web/app/admin/customers/_components/store-credit-ledger.test.ts`

### Task 4: Regression and completion verification

**Files:**
- Verify all modified files from Tasks 1–3.

**Interfaces:**
- Consumes: the completed domain, API, and UI implementations.
- Produces: verified Store Credit ledger modal behavior on the CDP.

- [ ] **Step 1: Format and inspect the final diff**

Run: `pnpm format`

Run: `git diff --check`

- [ ] **Step 2: Run static validation**

Run: `pnpm lint`

Run: `pnpm typecheck`

- [ ] **Step 3: Run the complete automated suite**

Run: `pnpm test`

With Docker services healthy and `DATABASE_URL=postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe`, run: `pnpm test:integration`.

- [ ] **Step 4: Run the production build**

Run: `pnpm build`

- [ ] **Step 5: Manually verify the CDP states in the browser**

Verify a customer with no history shows `-` without a chevron; add credit and verify balance plus chevron; deduct back to zero and verify `$0.00 USD`; open the modal, paginate, retry a failed request, close it by button/backdrop/Escape, and transition from `Adjust balance` to the existing adjustment modal.

- [ ] **Step 6: Commit the implementation**

Stage only the intended feature files and commit with `Add customer store credit ledger modal`.
