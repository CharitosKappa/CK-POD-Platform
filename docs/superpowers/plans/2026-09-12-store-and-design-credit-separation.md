# Store Credit and Design Credits Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real USD Store Credit balance and append-only ledger for every customer, expose safe manual adjustments in the customer admin, and clearly separate that monetary value from generation-only Design Credits everywhere customers or staff can see it.

**Architecture:** Keep the existing integer-based `credit_accounts`, `credit_ledger`, `CreditService`, and `/api/credits` contracts unchanged as the Design Credits subsystem. Introduce a separate monetary Store Credit aggregate with one lazily-created account per customer, an append-only ledger, serialized balance mutation, idempotent admin adjustments, and customer-timeline projection. The admin UI reads both balances from the customer detail endpoint, displays them as separate sidebar cards, and submits Store Credit adjustments through a dedicated authenticated API route and focused modal.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, PostgreSQL/Drizzle SQL migrations, Vitest, pnpm.

**Spec:** [`docs/superpowers/specs/2026-09-12-store-and-design-credit-separation-design.md`](../specs/2026-09-12-store-and-design-credit-separation-design.md)

## Global Constraints

- Preserve the existing Design Credits database schema, services, API paths, and TypeScript property names for backward compatibility. Rename only user/admin-visible generation-credit copy in this slice.
- Do not use Store Credit during checkout and do not automatically issue it from refunds yet. Those are later integrations.
- Store all Store Credit monetary amounts as integer USD cents. Never use JavaScript floating-point arithmetic for database mutations.
- Store Credit balances may never be negative. Every mutation must lock the account row and append exactly one ledger entry in the same database transaction.
- Only active `OWNER` and `OPERATIONS` staff sessions may adjust Store Credit. `PREPRESS`, `READ_ONLY`, customer, and anonymous sessions may not.
- Do not add expiry or customer-notification behavior in this slice.
- Preserve the current uncommitted customer-detail and preferred-locale work. Migration `0039_customer_preferred_locale.sql` already exists locally, so this feature must use migration number `0040` and append to the existing journal entry rather than replacing it.
- Stage and commit only the files named by each task; the worktree already contains unrelated uncommitted changes.

---

## Task 1: Add the independent Store Credit schema

**Files:**

- Create: `packages/db/drizzle/0040_store_credit_ledger.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/required-tables.ts`
- Test: `packages/db/src/required-tables.test.ts`

- [ ] **Step 1: Write the failing required-table assertions**

Extend `packages/db/src/required-tables.test.ts` so the test explicitly expects both new table names:

```ts
expect(requiredApplicationTables).toContain('store_credit_accounts');
expect(requiredApplicationTables).toContain('store_credit_ledger');
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
pnpm test -- packages/db/src/required-tables.test.ts
```

Expected: FAIL because the two Store Credit tables are not yet in the required-table manifest.

- [ ] **Step 3: Add the SQL migration**

Create `packages/db/drizzle/0040_store_credit_ledger.sql` with this structure:

```sql
CREATE TABLE app.store_credit_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id uuid NOT NULL UNIQUE
    REFERENCES app.customer_profiles(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  current_balance_cents integer NOT NULL DEFAULT 0
    CHECK (current_balance_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.store_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_credit_account_id uuid NOT NULL
    REFERENCES app.store_credit_accounts(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('CREDIT', 'DEBIT')),
  amount_cents integer NOT NULL CHECK (
    (entry_type = 'CREDIT' AND amount_cents > 0)
    OR (entry_type = 'DEBIT' AND amount_cents < 0)
  ),
  balance_after_cents integer NOT NULL CHECK (balance_after_cents >= 0),
  reason text NOT NULL CHECK (
    reason IN ('REFUND', 'PROMOTION', 'CUSTOMER_SERVICE', 'OTHER')
  ),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  actor_staff_member_id uuid NOT NULL
    REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 12 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_credit_account_id, idempotency_key)
);

CREATE INDEX store_credit_ledger_account_created_idx
  ON app.store_credit_ledger(store_credit_account_id, created_at DESC, id DESC);

CREATE INDEX store_credit_ledger_actor_created_idx
  ON app.store_credit_ledger(actor_staff_member_id, created_at DESC);
```

Append journal entry `idx: 39`, tag `0040_store_credit_ledger`, version `7`, `breakpoints: true`, with a `when` value greater than the existing `0039` entry.

- [ ] **Step 4: Register both tables in the database integrity manifest**

Add `store_credit_accounts` and `store_credit_ledger` to `requiredApplicationTables` in alphabetical order within the existing array.

- [ ] **Step 5: Run the database unit test**

Run:

```powershell
pnpm test -- packages/db/src/required-tables.test.ts
```

Expected: PASS.

- [ ] **Step 6: Apply and verify the migration against the local database**

Run:

```powershell
$env:DATABASE_URL = 'postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'
pnpm db:migrate
pnpm db:verify
```

Expected: migration `0040_store_credit_ledger` applies once and database verification reports both tables present.

- [ ] **Step 7: Commit only the schema slice**

```powershell
git add -- packages/db/drizzle/0040_store_credit_ledger.sql packages/db/drizzle/meta/_journal.json packages/db/src/required-tables.ts packages/db/src/required-tables.test.ts
git commit -m "Add store credit ledger schema"
```

## Task 2: Implement the transactional Store Credit domain service

**Files:**

- Create: `packages/domain/src/store-credit.ts`
- Create: `packages/domain/src/store-credit.test.ts`
- Create: `packages/domain/src/store-credit.integration.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Write unit tests for validation and authorization**

Cover these cases in `packages/domain/src/store-credit.test.ts`:

```ts
it('accepts exact USD decimal strings and converts them to cents');
it('rejects zero, negative, exponent, comma, and over-two-decimal amounts');
it('rejects adjustments above $100,000.00');
it.each(['PREPRESS', 'READ_ONLY'] as const)('denies %s staff adjustments');
it.each(['OWNER', 'OPERATIONS'] as const)('allows %s staff adjustments');
it('requires a supported reason and limits the internal note to 1000 characters');
```

Use exact decimal-string parsing rather than `Number(amount) * 100`:

```ts
export function parseUsdCents(value: string): number {
  const match = /^(0|[1-9]\d{0,5})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new StoreCreditValidationError('Enter a valid USD amount.');
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (cents < 1 || cents > 10_000_000)
    throw new StoreCreditValidationError('Enter an amount between $0.01 and $100,000.00.');
  return cents;
}
```

- [ ] **Step 2: Run the focused unit test and confirm it fails**

Run:

```powershell
pnpm test -- packages/domain/src/store-credit.test.ts
```

Expected: FAIL because the Store Credit domain module does not exist.

- [ ] **Step 3: Define the public Store Credit contracts and errors**

In `packages/domain/src/store-credit.ts`, define:

```ts
export const storeCreditReasons = [
  'REFUND',
  'PROMOTION',
  'CUSTOMER_SERVICE',
  'OTHER',
] as const;

export type StoreCreditReason = (typeof storeCreditReasons)[number];
export type StoreCreditDirection = 'CREDIT' | 'DEBIT';

export interface StoreCreditStaffActor {
  staffMemberId: string;
  email: string;
  role: StaffRole;
}

export interface StoreCreditAdjustmentInput {
  direction: StoreCreditDirection;
  amount: string;
  reason: StoreCreditReason;
  note?: string;
  idempotencyKey: string;
}

export interface StoreCreditAdjustmentResult {
  entryId: string;
  balanceCents: number;
  currency: 'USD';
  duplicate: boolean;
}

export class StoreCreditAccessError extends Error {}
export class StoreCreditValidationError extends Error {}
export class StoreCreditConflictError extends Error {}
```

Export the module from `packages/domain/src/index.ts`.

- [ ] **Step 4: Implement serialized, idempotent balance mutation**

Implement `StoreCreditService.adjust(actor, customerId, input)` using `withTransaction`:

1. Require `OWNER` or `OPERATIONS`.
2. Validate the customer UUID, direction, reason, note, idempotency key, and amount.
3. Confirm `app.customer_profiles` contains the target customer.
4. Lazily insert `app.store_credit_accounts` with `ON CONFLICT (customer_profile_id) DO NOTHING`.
5. Select the account row `FOR UPDATE`.
6. Look up the `(account_id, idempotency_key)` ledger row after acquiring the lock. If present, return its original result with `duplicate: true`.
7. Convert the positive input cents to a signed delta. Reject a debit that would make the balance negative with `StoreCreditConflictError('Store credit cannot be reduced below $0.00.')`.
8. Update `current_balance_cents` and `updated_at`.
9. Insert exactly one ledger row containing the signed delta and new balance.
10. Return the created entry and balance with `duplicate: false`.

The core transaction must follow this shape:

```ts
return withTransaction(this.pool, async (client) => {
  await ensureAccount(client, customerId);
  const account = await lockAccount(client, customerId);
  const duplicate = await findAdjustment(client, account.id, idempotencyKey);
  if (duplicate) return mapAdjustment(duplicate, true);

  const delta = direction === 'CREDIT' ? amountCents : -amountCents;
  const balanceCents = account.currentBalanceCents + delta;
  if (balanceCents < 0)
    throw new StoreCreditConflictError('Store credit cannot be reduced below $0.00.');

  await updateBalance(client, account.id, balanceCents);
  return insertLedgerEntry(client, {
    accountId: account.id,
    actorStaffMemberId: actor.staffMemberId,
    amountCents: delta,
    balanceCents,
    direction,
    idempotencyKey,
    note,
    reason,
  });
});
```

- [ ] **Step 5: Run the unit tests**

Run:

```powershell
pnpm test -- packages/domain/src/store-credit.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write database integration tests for ledger invariants**

In `packages/domain/src/store-credit.integration.test.ts`, create an isolated staff member and customer profile and verify:

```ts
it('adds and deducts USD store credit while appending an auditable ledger');
it('returns the original adjustment when an idempotency key is retried');
it('serializes concurrent debits so the balance never becomes negative');
it('persists staff actor, reason, note, signed amount, and balance after');
```

The concurrency test should seed `$10.00`, run two simultaneous `$7.00` debits, and assert one succeeds, one conflicts, final balance is `$3.00`, and only one debit ledger row exists.

- [ ] **Step 7: Add the new integration file to the root integration script**

Append `packages/domain/src/store-credit.integration.test.ts` to `test:integration` in `package.json` so the behavior remains part of the standard database gate.

- [ ] **Step 8: Run the integration test**

Run:

```powershell
$env:DATABASE_URL = 'postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'
pnpm test -- packages/domain/src/store-credit.integration.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit only the domain slice**

```powershell
git add -- packages/domain/src/store-credit.ts packages/domain/src/store-credit.test.ts packages/domain/src/store-credit.integration.test.ts packages/domain/src/index.ts package.json
git commit -m "Implement transactional store credit service"
```

## Task 3: Expose Store Credit through customer detail reads and timeline projection

**Files:**

- Modify: `packages/domain/src/customer-operations.ts`
- Modify: `packages/domain/src/customer-operations.test.ts`
- Modify: `packages/domain/src/store-credit.integration.test.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-types.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-timeline.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-timeline.test.ts`

- [ ] **Step 1: Add failing customer-read tests**

Extend `packages/domain/src/customer-operations.test.ts` to require:

```ts
expect(detail).toMatchObject({
  storeCreditBalanceCents: 2599,
  storeCreditCurrency: 'USD',
});
```

Also assert the customer identity SQL left-joins `app.store_credit_accounts`, so customers without an account still load with a zero balance.

- [ ] **Step 2: Add failing timeline presentation tests**

Extend `customer-detail-timeline.test.ts` with one credit and one debit event:

```ts
expect(
  timelineContent({
    eventType: 'STORE_CREDIT_ADJUSTMENT',
    metadata: {
      amountCents: 1250,
      balanceAfterCents: 3750,
      direction: 'CREDIT',
      reason: 'CUSTOMER_SERVICE',
    },
    // existing timeline fields
  }),
).toEqual({
  title: 'Store credit added',
  description: '$12.50 · Customer service · Balance $37.50',
});
```

Add the equivalent negative-delta expectation with title `Store credit deducted`.

- [ ] **Step 3: Run both focused suites and confirm they fail**

```powershell
pnpm test -- packages/domain/src/customer-operations.test.ts apps/web/app/admin/customers/_components/customer-detail-timeline.test.ts
```

Expected: FAIL because the read model and formatter do not yet expose Store Credit.

- [ ] **Step 4: Extend the customer detail domain model**

Add to `OperationsCustomerDetail` and the internal identity row:

```ts
storeCreditBalanceCents: number;
storeCreditCurrency: 'USD';
```

Update the identity query with a left join and zero-value fallback:

```sql
LEFT JOIN app.store_credit_accounts store_credit
  ON store_credit.customer_profile_id = cp.id
```

```sql
coalesce(store_credit.current_balance_cents, 0)::int AS store_credit_balance_cents,
coalesce(store_credit.currency, 'USD') AS store_credit_currency
```

Map those fields into the API-ready detail object without changing `creditBalance`, which remains the Design Credits balance.

- [ ] **Step 5: Add Store Credit ledger rows to `customerTimeline`**

Add one query to the existing parallel timeline sources:

```sql
SELECT
  'store-credit:' || ledger.id::text AS id,
  'STORE_CREDIT_ADJUSTMENT' AS event_type,
  ledger.note AS body,
  jsonb_build_object(
    'amountCents', ledger.amount_cents,
    'balanceAfterCents', ledger.balance_after_cents,
    'direction', ledger.entry_type,
    'reason', ledger.reason,
    'currency', account.currency
  ) AS metadata,
  staff.normalized_email AS actor_label,
  ledger.created_at
FROM app.store_credit_ledger ledger
JOIN app.store_credit_accounts account ON account.id = ledger.store_credit_account_id
JOIN app.staff_members staff ON staff.id = ledger.actor_staff_member_id
WHERE account.customer_profile_id = $1
ORDER BY ledger.created_at DESC
LIMIT 150
```

Merge these rows into the same descending timeline sort. Do not write duplicate rows to `customer_timeline_events`; the Store Credit ledger itself is the source of truth.

- [ ] **Step 6: Extend the client types and formatter**

Add the two Store Credit fields to `CustomerDetail` in `customer-types.ts`. Add `STORE_CREDIT_ADJUSTMENT` handling to `timelineContent`, formatting all currency via the existing `en-US` USD formatter and converting reason enum values with the existing humanizer.

- [ ] **Step 7: Prove a real adjustment appears in the customer timeline**

Extend `store-credit.integration.test.ts` to call `CustomerOperationsService.getCustomer` after an adjustment and assert:

```ts
expect(detail.storeCreditBalanceCents).toBe(1250);
expect(detail.timeline).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      eventType: 'STORE_CREDIT_ADJUSTMENT',
      actorLabel: staffEmail,
    }),
  ]),
);
```

- [ ] **Step 8: Run focused tests**

```powershell
pnpm test -- packages/domain/src/customer-operations.test.ts packages/domain/src/store-credit.integration.test.ts apps/web/app/admin/customers/_components/customer-detail-timeline.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit only the read-model slice**

```powershell
git add -- packages/domain/src/customer-operations.ts packages/domain/src/customer-operations.test.ts packages/domain/src/store-credit.integration.test.ts apps/web/app/admin/customers/_components/customer-types.ts apps/web/app/admin/customers/_components/customer-detail-timeline.tsx apps/web/app/admin/customers/_components/customer-detail-timeline.test.ts
git commit -m "Expose store credit in customer details"
```

## Task 4: Add the authenticated admin adjustment API

**Files:**

- Modify: `apps/web/lib/platform.ts`
- Modify: `apps/web/lib/http.ts`
- Create: `apps/web/app/api/admin/customers/[customerId]/store-credit-adjustments/route.ts`
- Create: `apps/web/app/api/admin/customers/[customerId]/store-credit-adjustments/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Test the route contract at the handler boundary with mocked platform functions:

```ts
it('passes the authenticated staff actor and adjustment payload to StoreCreditService');
it('returns the new USD balance and ledger entry');
it('maps validation errors to 400, insufficient balance to 409, and access errors to 403');
```

The accepted request body is exactly:

```json
{
  "direction": "CREDIT",
  "amount": "25.00",
  "reason": "PROMOTION",
  "note": "Labor Day goodwill credit",
  "idempotencyKey": "store-credit-<client-generated-uuid>"
}
```

The successful response is:

```json
{
  "adjustment": {
    "entryId": "025d7a27-41a4-45bc-a32b-cb86bd9d89db",
    "balanceCents": 2500,
    "currency": "USD",
    "duplicate": false
  }
}
```

- [ ] **Step 2: Run the route suite and confirm it fails**

```powershell
pnpm test -- "apps/web/app/api/admin/customers/[customerId]/store-credit-adjustments/route.test.ts"
```

Expected: FAIL because the route and runtime do not exist.

- [ ] **Step 3: Wire the service runtime**

Import `StoreCreditService` in `apps/web/lib/platform.ts` and add:

```ts
export function storeCreditRuntime() {
  return new StoreCreditService(databasePool());
}
```

- [ ] **Step 4: Implement the POST route**

The route must:

1. Await `requireAdminSession()` before calling the domain service.
2. Read the JSON body without coercing amount to a number.
3. Pass the route `customerId` and full body to `storeCreditRuntime().adjust(session, customerId, body)`.
4. Return `{ adjustment }` as JSON.
5. Delegate all errors to `handleRouteError`.

- [ ] **Step 5: Add explicit HTTP error mappings**

Extend `handleRouteError`:

```ts
if (error instanceof StoreCreditAccessError)
  return NextResponse.json({ error: error.message }, { status: 403 });
if (error instanceof StoreCreditConflictError)
  return NextResponse.json({ error: error.message }, { status: 409 });
if (error instanceof StoreCreditValidationError)
  return NextResponse.json(
    { error: error.message },
    { status: error.message === 'Customer not found.' ? 404 : 400 },
  );
```

- [ ] **Step 6: Run the route suite**

```powershell
pnpm test -- "apps/web/app/api/admin/customers/[customerId]/store-credit-adjustments/route.test.ts"
```

Expected: PASS.

- [ ] **Step 7: Commit only the API slice**

```powershell
git add -- apps/web/lib/platform.ts apps/web/lib/http.ts "apps/web/app/api/admin/customers/[customerId]/store-credit-adjustments/route.ts" "apps/web/app/api/admin/customers/[customerId]/store-credit-adjustments/route.test.ts"
git commit -m "Add admin store credit adjustment API"
```

## Task 5: Build the separate sidebar cards and adjustment modal

**Files:**

- Modify: `apps/web/app/admin/customers/_components/customer-detail-client.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-sidebar.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-sidebar.test.ts`
- Create: `apps/web/app/admin/customers/_components/store-credit-adjustment.ts`
- Create: `apps/web/app/admin/customers/_components/store-credit-adjustment.test.ts`
- Create: `apps/web/app/admin/customers/_components/store-credit-adjustment-modal.tsx`
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Extend the sidebar render fixture and write failing structure tests**

Add to the fixture:

```ts
storeCreditBalanceCents: 2550,
storeCreditCurrency: 'USD',
```

Assert:

```ts
expect(markup).toContain('Design credits');
expect(markup).toContain('4 available');
expect(markup).toContain('Store credit');
expect(markup).toContain('$25.50');
expect(markup).toContain('aria-label="Adjust store credit"');

expect(markup.indexOf('Contact information')).toBeLessThan(markup.indexOf('Design credits'));
expect(markup.indexOf('Design credits')).toBeLessThan(markup.indexOf('Store credit'));
expect(markup.indexOf('Store credit')).toBeLessThan(markup.indexOf('Tags'));
expect(markup.indexOf('Tags')).toBeLessThan(markup.indexOf('Notes'));
```

Add an assertion that the compact metadata class appears on notification language, marketing values, and tax values.

- [ ] **Step 2: Write failing adjustment form-model tests**

In `store-credit-adjustment.test.ts`, test the pure helpers that the modal will use:

```ts
it('builds a credit payload without losing decimal precision');
it('builds a debit payload and trims its optional note');
it('requires an amount and reason before submission');
it('creates a new idempotency key for a new submit intent but reuses it while retrying the same request');
```

The payload helper must preserve `amount` as a string:

```ts
export function storeCreditAdjustmentPayload(
  draft: StoreCreditAdjustmentDraft,
  idempotencyKey: string,
) {
  return {
    direction: draft.direction,
    amount: draft.amount.trim(),
    reason: draft.reason,
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    idempotencyKey,
  };
}
```

- [ ] **Step 3: Run both focused suites and confirm they fail**

```powershell
pnpm test -- apps/web/app/admin/customers/_components/customer-detail-sidebar.test.ts apps/web/app/admin/customers/_components/store-credit-adjustment.test.ts
```

Expected: FAIL because the cards, fields, action, and helper do not exist.

- [ ] **Step 4: Update sidebar content and order**

In `customer-detail-sidebar.tsx`:

- Extend `CustomerSidebarAction` with `'storeCredit'`.
- Keep Contact Information first.
- Add a non-editable Design Credits card showing `{customer.creditBalance} available`.
- Replace the hardcoded `Store credit / None` card with the formatted USD balance and a pencil button labeled `Adjust store credit` that calls `choose('storeCredit')`.
- Keep Tags and Notes after the two credit cards.

Use a fixed formatter:

```ts
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
```

- [ ] **Step 5: Remove Design Credits from the top metrics**

Delete the metric rendered with `label="Credits"` from `customer-detail-client.tsx`. The remaining order must be:

1. Amount spent
2. Orders
3. Average order
4. Return rate

Change desktop `.customer-detail-metrics` to `repeat(4, minmax(0, 1fr))`. In the mobile rule, preserve a two-column/two-row grid: remove the old last-child full-row override and apply bottom borders only to the first two cells.

- [ ] **Step 6: Implement the focused Shopify-like modal**

Create `store-credit-adjustment-modal.tsx` with:

- Dialog title `Adjust store credit` and close button.
- Segmented Add/Deduct control, defaulting to Add.
- Disabled Currency field showing `USD ($)`.
- Amount text input with `inputMode="decimal"`, no `type="number"` floating-point coercion.
- Required reason select: Refund, Promotion, Customer service, Other.
- Optional internal note textarea.
- Current balance and projected balance summary.
- Cancel and contextual `Add store credit` / `Deduct store credit` submit buttons.
- `aria-modal="true"`, focusable controls, Escape/backdrop close using the existing modal conventions.
- Loading, inline validation, and API error states.

Generate the request key with `createClientIdempotencyKey()`. Retain the same key when retrying a failed or uncertain submission; reset it only after success or after the user changes amount/direction/reason/note.

After a successful response, call `onSaved('Store credit updated.')`; the parent already re-fetches the complete customer so the balance and timeline refresh together.

- [ ] **Step 7: Route the new modal separately from existing customer edit modals**

In `customer-detail-client.tsx`, render `StoreCreditAdjustmentModal` only when `modal === 'storeCredit'`; render the existing `CustomerDetailModal` for the other modal names. This avoids expanding the already multi-purpose edit modal.

- [ ] **Step 8: Fix Contact Information typography with one explicit compact token**

Add a shared CSS variable and class instead of relying on inherited `p` styles:

```css
.customer-contact-card {
  --customer-sidebar-meta-size: 0.7rem;
}
.customer-contact-card .customer-sidebar-copy {
  margin: 0;
  color: #363832;
  font-size: var(--customer-sidebar-meta-size);
  font-weight: 400;
  line-height: 1.35;
}
```

Apply `customer-sidebar-copy` to:

- `Will receive notifications in English`
- Marketing subscriptions value
- Both Tax details values
- Empty values inside those subsections

Keep subsection labels bold, but set their sizing from the same variable unless visual verification shows the label needs the already-established smaller overline treatment. The values must no longer inherit any larger generic paragraph rule.

Add modal/card styles consistent with the existing Shopify-like customer admin: white surface, restrained border/shadow, compact labels, disabled currency treatment, red destructive emphasis only for debit confirmation where appropriate, and responsive bottom-sheet behavior on narrow screens.

- [ ] **Step 9: Run focused UI tests**

```powershell
pnpm test -- apps/web/app/admin/customers/_components/customer-detail-sidebar.test.ts apps/web/app/admin/customers/_components/store-credit-adjustment.test.ts apps/web/app/admin/customers/_components/customer-detail-timeline.test.ts
```

Expected: PASS.

- [ ] **Step 10: Verify the UI manually in the browser**

At a real route such as `/admin/customers/025d7a27-41a4-45bc-a32b-cb86bd9d89db` (using an ID that exists in the local database) verify:

1. Four top metrics only; no Credits metric.
2. Sidebar order is Contact Information → Design Credits → Store Credit → Tags → Notes.
3. Marketing subscriptions, Tax details, and notification language use the same compact body scale.
4. Store Credit shows `$0.00` when no account exists.
5. Pencil opens the modal.
6. Adding `$25.00` with Promotion updates the card to `$25.00` and adds a dated staff-attributed timeline entry.
7. Deducting `$5.50` updates the card to `$19.50` and adds a second timeline entry.
8. Deducting `$20.00` is rejected without changing either the balance or ledger.
9. Refreshing the page preserves the balance because it is database-backed.
10. Design Credits balance and history remain unchanged throughout.

- [ ] **Step 11: Commit only the admin UI slice**

```powershell
git add -- apps/web/app/admin/customers/_components/customer-detail-client.tsx apps/web/app/admin/customers/_components/customer-detail-sidebar.tsx apps/web/app/admin/customers/_components/customer-detail-sidebar.test.ts apps/web/app/admin/customers/_components/store-credit-adjustment.ts apps/web/app/admin/customers/_components/store-credit-adjustment.test.ts apps/web/app/admin/customers/_components/store-credit-adjustment-modal.tsx apps/web/app/globals.css
git commit -m "Separate store and design credits in customer admin"
```

## Task 6: Normalize visible Design Credits copy without breaking contracts

**Files:**

- Modify: `apps/web/app/production-create-experience.tsx`
- Modify: `apps/web/app/account/account-screen.tsx`
- Modify: `apps/web/app/ops/customers/operations-customer-list.tsx`
- Modify: `apps/ux-prototype/app/create-experience.tsx`
- Modify: `apps/ux-prototype/app/support-pages.tsx`
- Test: existing adjacent UI/unit suites discovered by `pnpm test`

- [ ] **Step 1: Audit every visible credit string before editing**

Run:

```powershell
rg -n -i "credit|credits" apps/web/app apps/ux-prototype/app -g "*.ts" -g "*.tsx"
```

Classify every match before changing it:

- Generation currency visible to a user/admin → use `design credit` / `design credits`.
- Store Credit money → keep `Store credit`.
- Referral money such as `Get $10 credit` → keep monetary wording.
- Payment text such as `Credit or debit card` → keep payment wording.
- Internal variables, route segments, API paths, TypeScript properties, and database names → keep unchanged.

- [ ] **Step 2: Update the known generation-credit copy**

At minimum, normalize these phrases:

```text
Your credit wasn’t used.           → Your design credit wasn’t used.
1 credit                           → 1 design credit
N credits available               → N design credits available
Buy credits                        → Buy design credits
You’re out of credits              → You’re out of design credits
Your credit history will appear.  → Your design credit history will appear.
No credit activity yet.            → No design credit activity yet.
Credit returned                    → Design credit returned
Credits added                      → Design credits added
No credits                         → No design credits
```

Keep text grammatically singular/plural where the balance is dynamic.

- [ ] **Step 3: Add or update copy assertions in the nearest existing tests**

Where a touched component already has a render/behavior test, assert `Design credit(s)` appears and generic generation-credit wording does not. Do not create brittle full-page snapshots solely for copy.

- [ ] **Step 4: Re-run the audit and manually inspect exceptions**

```powershell
rg -n -i "credit|credits" apps/web/app apps/ux-prototype/app -g "*.ts" -g "*.tsx"
```

Expected: all remaining visible generic `credit` strings are intentionally monetary/payment wording; technical identifiers remain unchanged.

- [ ] **Step 5: Run the complete non-database verification gate**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: all commands PASS with zero lint warnings and no whitespace errors.

- [ ] **Step 6: Run the complete database verification gate**

```powershell
$env:DATABASE_URL = 'postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'
pnpm db:verify
pnpm test:integration
```

Expected: database verification and all integration suites PASS, including Store Credit concurrency/idempotency coverage.

- [ ] **Step 7: Commit only the copy and adjacent test slice**

Stage the actual touched files from this task explicitly, then commit:

```powershell
git commit -m "Clarify design credit language"
```

## Task 7: Final regression and handoff

**Files:**

- Review only: all files changed by Tasks 1–6
- Update if needed: `docs/superpowers/specs/2026-09-12-store-and-design-credit-separation-design.md` only when implementation reveals an approved-spec discrepancy

- [ ] **Step 1: Review the final diff against the approved spec**

Confirm every acceptance condition:

- Separate Store Credit and Design Credits UI cards.
- Design Credits absent from top metrics.
- Real Store Credit account and append-only ledger in PostgreSQL.
- Fixed USD currency and cents-safe arithmetic.
- Add/Deduct with required reason and optional note.
- No negative balance.
- Idempotent and concurrency-safe mutations.
- Staff attribution and customer timeline visibility.
- No Store Credit checkout redemption, automatic refund issue, expiry, or notification yet.
- Existing Design Credits behavior and technical interfaces preserved.
- Contact Information typography corrected.

- [ ] **Step 2: Inspect repository state before any final commit or push**

```powershell
git status --short
git diff --stat
git log --oneline -8
```

Do not stage or discard the pre-existing uncommitted customer/language work. If any feature file overlaps it, review the patch hunk-by-hunk and preserve both sets of changes.

- [ ] **Step 3: Run one final verification pass after all conflict resolution**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
$env:DATABASE_URL = 'postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'
pnpm db:verify
pnpm test:integration
git diff --check
```

Expected: every gate PASS from the final working tree.

- [ ] **Step 4: Prepare the handoff report**

Report:

- Database migration and tables added.
- Domain invariants and authorization enforced.
- API route and modal behavior.
- Customer detail/sidebar/timeline changes.
- Visible Design Credits copy normalization.
- Exact verification commands and results.
- Remaining deliberate later-phase items: checkout redemption, automated refund issuance, expiry, and customer notification.
- Commit hashes created for the implementation slices.
