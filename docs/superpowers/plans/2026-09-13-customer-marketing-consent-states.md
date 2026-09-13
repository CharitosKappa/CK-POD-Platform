# Customer Marketing Consent States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous marketing `UNKNOWN` state with durable `NOT_SUBSCRIBED`, `SUBSCRIBED`, and `UNSUBSCRIBED` lifecycle semantics for email and SMS.

**Architecture:** The shared domain contract defines the allowed persisted states, while a pure transition function derives the correct next state from the previous state and an explicit opt-in choice. PostgreSQL stores only those three states and backfills legacy rows conservatively. Admin UI, URLs, exports, fixtures, and timeline metadata consume the same contract without independently recreating transition rules.

**Tech Stack:** TypeScript, React, Next.js, PostgreSQL/Drizzle SQL migrations, Vitest, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-09-13-customer-marketing-consent-states-design.md`

## Global Constraints

- `NOT_SUBSCRIBED` means the customer has never granted consent.
- `SUBSCRIBED` means active promotional consent.
- `UNSUBSCRIBED` means previously subscribed and later withdrew consent.
- Email and SMS states are independent.
- Only exact `SUBSCRIBED` is promotional-send eligible.
- Transactional messaging behavior must not change.
- Existing UUIDs and all unrelated customer data must remain unchanged.
- Preserve the existing uncommitted development customer spend corrections.

---

### Task 1: Shared consent contract and transition state machine

**Files:**

- Modify: `packages/domain/src/customer-contracts.ts`
- Modify: `packages/domain/src/customer-contracts.test.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-types.ts`

**Interfaces:**

- Produces: `marketingStatuses = ['NOT_SUBSCRIBED', 'SUBSCRIBED', 'UNSUBSCRIBED']`
- Produces: `resolveMarketingStatus(previous: MarketingStatus | null, subscribed: boolean): MarketingStatus`
- Consumed by: customer create/edit mutations and all web status types.

- [ ] **Step 1: Write failing contract tests**

Add assertions proving `UNKNOWN` is rejected, all three states are accepted, and transitions preserve history:

```ts
expect(marketingStatuses).toEqual(['NOT_SUBSCRIBED', 'SUBSCRIBED', 'UNSUBSCRIBED']);
expect(resolveMarketingStatus(null, false)).toBe('NOT_SUBSCRIBED');
expect(resolveMarketingStatus('NOT_SUBSCRIBED', true)).toBe('SUBSCRIBED');
expect(resolveMarketingStatus('SUBSCRIBED', false)).toBe('UNSUBSCRIBED');
expect(resolveMarketingStatus('UNSUBSCRIBED', false)).toBe('UNSUBSCRIBED');
expect(resolveMarketingStatus('UNSUBSCRIBED', true)).toBe('SUBSCRIBED');
```

- [ ] **Step 2: Run the focused test and confirm it fails because the enum/function is missing**

Run: `pnpm test -- packages/domain/src/customer-contracts.test.ts`

- [ ] **Step 3: Implement the minimal shared enum and transition function**

```ts
export const marketingStatuses = ['NOT_SUBSCRIBED', 'SUBSCRIBED', 'UNSUBSCRIBED'] as const;

export function resolveMarketingStatus(
  previous: MarketingStatus | null,
  subscribed: boolean,
): MarketingStatus {
  if (subscribed) return 'SUBSCRIBED';
  return previous === 'SUBSCRIBED' || previous === 'UNSUBSCRIBED'
    ? 'UNSUBSCRIBED'
    : 'NOT_SUBSCRIBED';
}
```

Mirror the new union in the web boundary type.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `pnpm test -- packages/domain/src/customer-contracts.test.ts`

### Task 2: PostgreSQL migration and development fixtures

**Files:**

- Create: `packages/db/drizzle/0045_customer_marketing_consent_states.sql`
- Modify: `packages/db/src/required-tables.test.ts`
- Modify: `packages/db/src/development-customer-fixtures.ts`
- Modify: `packages/db/src/development-customer-fixtures.test.ts`

**Interfaces:**

- Consumes: the three-state vocabulary from Task 1.
- Produces: three-state database constraints and `NOT_SUBSCRIBED` defaults.

- [ ] **Step 1: Write failing migration/fixture assertions**

Assert that development fixtures contain no `UNKNOWN`, contain all three supported states, and the required migration list includes `0045_customer_marketing_consent_states.sql`.

- [ ] **Step 2: Run focused database tests and confirm failure**

Run: `pnpm test -- packages/db/src/required-tables.test.ts packages/db/src/development-customer-fixtures.test.ts`

- [ ] **Step 3: Add the idempotent migration**

The migration must:

```sql
ALTER TABLE app.customer_profiles DROP CONSTRAINT customer_profiles_email_marketing_status_check;
ALTER TABLE app.customer_profiles DROP CONSTRAINT customer_profiles_sms_marketing_status_check;

UPDATE app.customer_profiles
SET email_marketing_status = 'UNSUBSCRIBED'
WHERE email_marketing_status = 'NOT_SUBSCRIBED'
  AND EXISTS (
    SELECT 1 FROM app.customer_timeline_events event
    WHERE event.customer_profile_id = customer_profiles.id
      AND event.event_type = 'CONSENT_UPDATED'
      AND event.metadata->>'emailMarketingStatus' = 'SUBSCRIBED'
  );

UPDATE app.customer_profiles SET email_marketing_status = 'NOT_SUBSCRIBED'
WHERE email_marketing_status = 'UNKNOWN';
```

Apply the equivalent SMS backfill, change both defaults to `NOT_SUBSCRIBED`, and add checks allowing only the new three states. Constraint names must be discovered from the current database schema and dropped deterministically.

- [ ] **Step 4: Update development fixtures to exercise all three states**

Replace fixture `UNKNOWN` values with a deterministic mix of `NOT_SUBSCRIBED` and `UNSUBSCRIBED` while preserving the existing priced-order correction.

- [ ] **Step 5: Run focused database tests and migration verification**

Run: `pnpm test -- packages/db/src/required-tables.test.ts packages/db/src/development-customer-fixtures.test.ts`

Run with local PostgreSQL: `pnpm db:migrate` followed by `pnpm db:verify`.

### Task 3: Domain create/edit transitions and audit metadata

**Files:**

- Modify: `packages/domain/src/customer-operations.ts`
- Modify: `packages/domain/src/customer-operations.test.ts`
- Modify: `packages/domain/src/customer-addresses.integration.test.ts`

**Interfaces:**

- Consumes: `resolveMarketingStatus` and the three-state `MarketingStatus`.
- Produces: server-owned consent transitions and timeline metadata containing previous/new states per channel.

- [ ] **Step 1: Write failing domain tests**

Cover these behaviors with real service inputs:

```ts
// Creation without opt-in
expect(created.emailMarketingStatus).toBe('NOT_SUBSCRIBED');

// Explicit withdrawal
expect(resolveUpdate('SUBSCRIBED', false)).toBe('UNSUBSCRIBED');

// An already-unsubscribed unchecked customer remains unsubscribed
expect(resolveUpdate('UNSUBSCRIBED', false)).toBe('UNSUBSCRIBED');
```

Assert `CONSENT_UPDATED` metadata records channel-specific `{ previousStatus, newStatus }` only for channels that changed.

- [ ] **Step 2: Run focused domain tests and confirm expected failures**

Run: `pnpm test -- packages/domain/src/customer-operations.test.ts`

- [ ] **Step 3: Move transition ownership into the service**

Read the current persisted status inside the existing transaction. Interpret the form's subscribed/unsubscribed choice through `resolveMarketingStatus`; never downgrade `UNSUBSCRIBED` to `NOT_SUBSCRIBED`. Continue rejecting `SUBSCRIBED` when privacy suppression is active.

- [ ] **Step 4: Write richer audit metadata**

Store:

```ts
{
  email: { previousStatus, newStatus },
  sms: { previousStatus, newStatus },
  source: 'ADMIN'
}
```

Omit unchanged channel entries and do not emit `CONSENT_UPDATED` when neither channel changes.

- [ ] **Step 5: Run domain unit and PostgreSQL integration tests**

Run: `pnpm test -- packages/domain/src/customer-operations.test.ts`

Run with local PostgreSQL: `pnpm test:integration`.

### Task 4: Admin UI, filters, URLs, timeline, and exports

**Files:**

- Modify: `apps/web/app/admin/customers/_components/admin-customers-client.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-email-subscription-status.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-email-subscription-status.test.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-list-url-state.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-list-url-state.test.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-timeline.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-timeline.test.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-modals.tsx`
- Modify: `packages/domain/src/customer-exports.test.ts`
- Modify: `scripts/reset-development-customers.ts`

**Interfaces:**

- Consumes: the new marketing enum and server transition behavior.
- Produces: customer-facing labels and admin filters with no dash/Unknown state.

- [ ] **Step 1: Change tests first**

Require exact labels:

```ts
expect(formatEmailSubscriptionStatus('SUBSCRIBED')).toBe('Subscribed');
expect(formatEmailSubscriptionStatus('NOT_SUBSCRIBED')).toBe('Not subscribed');
expect(formatEmailSubscriptionStatus('UNSUBSCRIBED')).toBe('Unsubscribed');
```

Require URL parsing to accept `UNSUBSCRIBED` and reject legacy `UNKNOWN`. Require timeline rendering to describe subscribe/unsubscribe/resubscribe changes from the new metadata. Require exports to retain exact new statuses.

- [ ] **Step 2: Run focused UI/export tests and confirm failures**

Run: `pnpm test -- apps/web/app/admin/customers/_components/customer-email-subscription-status.test.ts apps/web/app/admin/customers/_components/customer-list-url-state.test.ts apps/web/app/admin/customers/_components/customer-detail-timeline.test.ts packages/domain/src/customer-exports.test.ts`

- [ ] **Step 3: Update list UI and filters**

Replace the `Unknown` filter option with:

```tsx
<option value="UNSUBSCRIBED">Unsubscribed</option>
```

The table formatter must return the three exact labels and never return a dash for a valid persisted marketing state.

- [ ] **Step 4: Update form and timeline consumers**

Keep the simple checkbox interaction. Send the current unchecked status so the server can distinguish a new non-subscriber from an existing unsubscribed customer; when a checked control is cleared, request withdrawal without manufacturing `NOT_SUBSCRIBED` in browser code. Render the previous/new status pairs in readable timeline copy.

- [ ] **Step 5: Update URL parsing, reset fixtures, and export expectations**

All status allowlists must use the shared three values. CSV/API exports must expose exact stored values. Development reset inserts only the new states.

- [ ] **Step 6: Run focused UI/export tests and confirm they pass**

Run the command from Step 2 and require zero failures.

### Task 5: Full verification and working-tree review

**Files:**

- Review all files modified in Tasks 1–4.
- Preserve pre-existing uncommitted work not owned by this feature.

**Interfaces:**

- Consumes: completed feature.
- Produces: verified implementation ready for a later user-requested commit/push.

- [ ] **Step 1: Run formatting and static validation**

Run: `pnpm format`, `pnpm lint`, `pnpm typecheck`.

- [ ] **Step 2: Run all unit and integration tests**

Run: `pnpm test`.

Run with local PostgreSQL: `pnpm test:integration`.

- [ ] **Step 3: Build production bundles**

Run: `pnpm build`.

- [ ] **Step 4: Review migration and diff**

Run: `pnpm db:verify`, `git diff --check`, and `git status --short`. Confirm no legacy customer-marketing `UNKNOWN` references remain outside historical documentation/migrations and no unrelated user work was overwritten.

- [ ] **Step 5: Report results without committing or pushing**

List changed files, migration behavior, test/build evidence, and any physical limitations. Commit/push only when the user explicitly requests it.
