# Customers Admin Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Customers list and detail page reliable against production-scale data and real customer lifecycle changes while preserving the approved Shopify-like interface.

**Architecture:** PostgreSQL owns customer/order identity and paginated event ordering. The domain service exposes stable customer aggregates and a dedicated timeline page contract; Next.js routes enforce staff access and React clients render/persist only real data. Legacy email matching remains a narrowly scoped compatibility fallback for unlinked historical rows.

**Tech Stack:** PostgreSQL migrations, TypeScript domain services, Next.js App Router route handlers, React client components, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-13-customers-hardening-design.md`

## Global Constraints

- Preserve the approved Shopify-like Customers visual direction.
- Customer timeline page size is exactly 10 entries.
- English is the only supported customer notification language.
- Do not expose printer, print-area, or other unrelated technical data.
- Do not add a tax engine; remove unsupported tax/VAT presentation.
- Read-only staff must not be offered mutations.

---

### Task 1: Stable customer-to-order identity

**Files:**

- Create: `packages/db/drizzle/0041_customer_hardening.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/domain/src/customer-operations.ts`
- Modify: the order-creation transaction in `packages/domain/src/commerce.ts`
- Test: `packages/domain/src/customer-operations.test.ts`
- Test: the existing commerce integration test file that creates orders

**Interfaces:**

- `recordCustomerTouchpoint(...)` produces `Promise<string>` containing the customer profile id.
- Order reads match `orders.customer_profile_id = cp.id OR (orders.customer_profile_id IS NULL AND normalized email matches)`.

- [ ] Write a failing integration test that creates an order, links it to a customer profile, changes the customer email, and still returns the historical order from `getCustomer`.
- [ ] Run the targeted test and verify it fails because the order has no stable profile relationship.
- [ ] Add the nullable FK, backfill, relationship index, and legacy normalized-email expression index.
- [ ] Return the profile id from `recordCustomerTouchpoint`, persist it on newly created orders, and update customer order queries to use the stable relationship with a legacy fallback.
- [ ] Remove reconciliation calls from list/detail reads while retaining the explicit reconciliation function.
- [ ] Run the targeted integration test and verify it passes.

### Task 2: Accurate customer commerce metrics

**Files:**

- Modify: `packages/domain/src/customer-operations.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-types.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-client.tsx`
- Test: `packages/domain/src/customer-operations.test.ts`
- Test: the customer detail component test file

**Interfaces:**

- `OperationsCustomerDetail.refundedOrderRate: number` replaces `returnRate`.
- `totalSpentCents` and `averageOrderValueCents` use net successful revenue.

- [ ] Write failing tests for one completed order with a partial successful refund and one failed refund.
- [ ] Verify the tests fail because gross spend and ambiguous return semantics are returned.
- [ ] Aggregate successful refund cents per order, subtract them from completed order totals, and count refunded orders once.
- [ ] Rename the detail contract and label to `Refunded order rate`.
- [ ] Run domain and component tests and verify they pass.

### Task 3: Real server-side timeline pagination

**Files:**

- Modify: `packages/domain/src/customer-operations.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-types.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-client.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-timeline.tsx`
- Create: `apps/web/app/api/admin/customers/[customerId]/timeline/route.ts`
- Create: `apps/web/app/api/admin/customers/[customerId]/timeline/route.test.ts`
- Test: `apps/web/app/admin/customers/_components/customer-detail-timeline.test.ts`

**Interfaces:**

- `listCustomerTimeline(actor, customerId, { page, limit })` returns `{ entries, total, page, limit }`.
- `GET /api/admin/customers/:customerId/timeline?page=N&limit=10` returns the same shape.
- `OperationsCustomerDetail.latestNote` contains the newest profile-note text or `null`.

- [ ] Write a failing domain test proving page two returns events older than the first 10 and reports the full total.
- [ ] Write a failing route test for invalid pagination and read-only staff access.
- [ ] Replace the nine capped queries/in-memory slice with a parameterized SQL union ordered and paginated in PostgreSQL.
- [ ] Add the timeline route and fetch each page from the client without reloading the customer detail payload.
- [ ] Query `latestNote` independently for the sidebar and remove its dependency on timeline contents.
- [ ] Run domain, route, and timeline component tests and verify they pass.

### Task 4: Non-destructive customer data editing

**Files:**

- Create: `packages/db/drizzle/0042_customer_tag_canonicalization.sql`
- Modify: `packages/domain/src/customer-contracts.ts`
- Modify: `packages/domain/src/customer-operations.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-editing.ts`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-modals.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-sidebar.tsx`
- Test: `packages/domain/src/customer-operations.test.ts`
- Test: existing customer detail editing/sidebar tests

**Interfaces:**

- `CustomerAddressInput` includes `recipientName?: string` and `phone?: string`.
- Tag normalization compares canonical lowercase values while preserving stored display casing.

- [ ] Write failing tests that updating a default address preserves a second address and that `VIP`, `Vip`, and `vip` resolve to one tag.
- [ ] Verify the tests fail for delete-all address replacement and case-sensitive tags.
- [ ] Deduplicate existing tags in the migration and add a unique index on `lower(value)`.
- [ ] Change address replacement to update the existing default row or insert a new default row without deleting other rows; preserve recipient and phone fields.
- [ ] Normalize tags case-insensitively in domain writes and reuse existing canonical tags.
- [ ] Remove unsupported Tax details and hardcoded order source copy from the detail UI.
- [ ] Run the targeted tests and verify they pass.

### Task 5: Persisted, readable, permission-aware Customers UI

**Files:**

- Modify: `apps/web/lib/admin-preferences.ts`
- Modify: the admin shell role context file discovered under `apps/web/app/admin`
- Modify: `apps/web/app/admin/customers/_components/admin-customers-client.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-client.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-sidebar.tsx`
- Modify: `apps/web/app/admin/admin.css`
- Test: the existing admin preferences and customer component tests

**Interfaces:**

- Admin preferences persist `customerSort` with a validated `CustomerSort` value.
- Customer clients consume the current staff role and expose mutations only to owner/operations roles.

- [ ] Write failing tests for saved sort restoration and mutation visibility for a read-only staff fixture.
- [ ] Verify failures show sort is transient and mutation controls are unconditional.
- [ ] Extend the versioned local preference contract with customer sort and wire it to list state updates.
- [ ] Provide staff role through the existing admin shell boundary and gate add/edit/tag/note/store-credit controls.
- [ ] Make selection, customer-name, and email columns sticky with opaque backgrounds and correct stacking while horizontally scrolling.
- [ ] Run the targeted component tests and verify they pass.

### Task 6: Regression and production validation

**Files:**

- Modify only files required by verification failures.

**Interfaces:**

- The complete Customers list/detail flow remains compatible with existing APIs except for the intentional `refundedOrderRate` contract rename.

- [ ] Run `pnpm format:check` and fix only touched-file formatting failures.
- [ ] Run `pnpm lint` and `pnpm typecheck`.
- [ ] Run targeted customer tests, then `pnpm test`.
- [ ] Run customer/commerce integration tests against the local PostgreSQL service.
- [ ] Run `pnpm build`.
- [ ] Manually verify list sorting/scrolling, customer detail metrics, timeline page navigation, address preservation, tag deduplication, and read-only presentation in the browser.
- [ ] Confirm `apps/web/next-env.d.ts` contains no accidental dev-server-only diff before handoff.
