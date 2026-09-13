# Customers Follow-up Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real customer address book, shareable Customers list state, and isolated integration-test database execution.

**Architecture:** Customer address mutations live in the domain service and are exposed through scoped admin routes. A pure URL-state adapter keeps list state deterministic. A cross-platform TypeScript runner provisions and migrates a separate integration database before launching Vitest.

**Tech Stack:** PostgreSQL, TypeScript, Next.js App Router, React, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-13-customers-follow-up-hardening-design.md`

## Global Constraints

- Preserve the approved Customers visual direction.
- Do not commit or push until explicitly requested.
- READ_ONLY staff must not receive mutation controls.
- Never run integration tests against the development database.

---

### Task 1: Customer address book domain and API

**Files:**

- Modify: `packages/domain/src/customer-contracts.ts`
- Modify: `packages/domain/src/customer-operations.ts`
- Modify: `packages/domain/src/customer-operations.test.ts`
- Create: `packages/db/drizzle/0043_customer_address_timeline.sql`
- Create: `apps/web/app/api/admin/customers/[customerId]/addresses/route.ts`
- Create: `apps/web/app/api/admin/customers/[customerId]/addresses/[addressId]/route.ts`

**Interfaces:**

- `createCustomerAddress(actor, customerId, input): Promise<string>`
- `updateCustomerAddress(actor, customerId, addressId, input): Promise<void>`
- `deleteCustomerAddress(actor, customerId, addressId): Promise<void>`

- [x] Write failing tests for add, edit, set-default, scoped delete, and default promotion.
- [x] Run the targeted tests and confirm the missing behavior fails.
- [x] Add address mutation methods, validation, transactions, and timeline events.
- [x] Add authenticated admin routes for the domain methods.
- [x] Run targeted domain and route tests.

### Task 2: Shopify-like address manager modal

**Files:**

- Modify: `apps/web/app/admin/customers/_components/customer-detail-client.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-modals.tsx`
- Modify: `apps/web/app/admin/customers/_components/customer-detail-sidebar.tsx`
- Modify: `apps/web/app/globals.css`
- Test: customer detail component/helper tests

**Interfaces:**

- Address manager consumes `CustomerDetail.addresses` and refreshes the CDP after successful mutations.

- [x] Write failing tests for address-manager presentation and source permissions.
- [x] Run the tests and verify the single-address editor fails them.
- [x] Implement list, add/edit form, delete confirmation, and default selection in one modal.
- [x] Verify owner/operations and read-only presentations.

### Task 3: URL-owned Customers list state

**Files:**

- Create: `apps/web/app/admin/customers/_components/customer-list-url-state.ts`
- Create: `apps/web/app/admin/customers/_components/customer-list-url-state.test.ts`
- Modify: `apps/web/app/admin/customers/_components/admin-customers-client.tsx`

**Interfaces:**

- `parseCustomerListUrlState(search, defaults)` validates and returns list state.
- `writeCustomerListUrlState(state)` returns canonical query parameters.

- [x] Write failing round-trip and invalid-value tests.
- [x] Implement the pure parser/serializer.
- [x] Initialize the list from URL with local preferences as fallback.
- [x] Synchronize debounced search, filters, sort, view, and page to the current URL.
- [x] Run URL-state and customer list tests.

### Task 4: Isolated integration database runner

**Files:**

- Create: `scripts/integration-test-database.ts`
- Create: `scripts/integration-test-database.test.ts`
- Create: `scripts/run-integration-tests.ts`
- Modify: `package.json`

**Interfaces:**

- `resolveIntegrationDatabaseUrls(environment)` returns source/admin/test URLs and whether provisioning is required.
- Runner migrates and tests only the resolved test database.

- [x] Write failing URL derivation, explicit override, and same-database guard tests.
- [x] Implement pure URL resolution.
- [x] Implement local database provisioning, migrations, and cross-platform Vitest launch.
- [x] Point `pnpm test:integration` at the runner and verify the development DB is unchanged.

### Task 5: Final verification

- [x] Run format, lint, typecheck, full tests, isolated integration tests, and build.
- [x] Apply and verify migrations.
- [x] Smoke-test address management and URL restoration in the browser.
- [x] Confirm the worktree remains uncommitted and unpushed.
