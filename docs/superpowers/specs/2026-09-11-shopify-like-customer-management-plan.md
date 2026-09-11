# Shopify-like customer management — implementation plan

## Delivery strategy

Implement the approved Customers slice vertically: durable profile data and domain behavior first,
then protected APIs, then the shared form and admin pages, followed by regression and browser QA.
Preserve the current dirty worktree and do not fold unrelated admin-shell, authentication or Orders
changes into customer-specific commits.

## 1. Establish migration and schema fixtures

**Files**

- Add `packages/db/drizzle/0037_customer_management.sql`.
- Update `packages/db/drizzle/meta/_journal.json`.
- Update the database verification fixture or script if it enumerates required customer objects.

**Work**

- Extend `app.customer_profiles` with nullable first name, last name and phone fields.
- Add constrained email/SMS marketing states: `UNKNOWN`, `NOT_SUBSCRIBED`, `SUBSCRIBED`.
- Add separate email/SMS consent-update timestamps.
- Create `app.customer_addresses` with postal/contact fields, timestamps, customer-profile foreign
  key and one-default-address-per-profile enforcement.
- Add indexes needed by customer search, view membership, location and recent activity.
- Preserve existing reconciled rows with null contact fields and `UNKNOWN` consent.
- Make migration application and backfill idempotent in the same style as migration 0033.

**Verification**

- Apply migrations against the local database.
- Run `pnpm db:verify`.
- Inspect constraints and indexes with read-only database queries.

## 2. Extract customer contracts and validation helpers

**Files**

- Add `packages/domain/src/customer-contracts.ts`.
- Add `packages/domain/src/customer-contracts.test.ts`.
- Update `packages/domain/src/index.ts` exports.

**Work**

- Define customer list views, sort values, filter contract, marketing states, address input,
  create/edit payloads and bulk-tag operation types.
- Define the named high-value threshold at USD 150 and the 30-day New window.
- Add deterministic normalization and validation for email, profile names, phone, tag limits and
  coherent partial/full address input.
- Add CSV field/column allowlists and escaping helpers.
- Keep HTTP concepts and React types out of the domain contracts.

**Verification**

- Unit-test valid/invalid addresses, normalized duplicate emails, phone validation, tag bounds,
  fixed-view parsing and CSV escaping for commas, quotes and newlines.

## 3. Extend the customer operations service

**Files**

- Refactor `packages/domain/src/customer-operations.ts` into focused query/mutation sections; split
  into `customer-queries.ts` and `customer-mutations.ts` only if the implementation becomes harder
  to understand in one file.
- Add `packages/domain/src/customer-operations.test.ts` for query-level behavior that does not need
  a database.
- Extend `packages/domain/src/commerce.integration.test.ts` or add
  `packages/domain/src/customer-operations.integration.test.ts` for durable behavior.

**Work**

- Expand the directory item with email/SMS status, location, last order and tags.
- Return one server-owned response containing page results plus the four approved metrics.
- Implement the five fixed views exactly as specified.
- Extend search to profile name, email, phone and address; add allowlisted filters/sorts.
- Compute paid/non-test order count, lifetime spend, AOV and returning percentage from canonical
  commerce records; exclude refunded money where the current order model can determine it.
- Expand detail with editable profile fields, profile address, recent orders, design activity,
  credits, tags, notes and timeline.
- Implement create and edit transactions with normalized-email conflict detection.
- Implement all-or-nothing add/remove bulk tags for explicit bounded customer IDs.
- Implement safe CSV generation for selected IDs or the current authorized filter.
- Attribute profile, address, consent, tag and note events to the authenticated staff actor.
- Enforce privacy suppression before changing a consent state to `SUBSCRIBED`.

**Verification**

- Integration-test view membership, metrics, filtering, pagination, profile creation/editing,
  duplicate conflicts, address replacement, consent transitions, privacy suppression, bulk-tag
  rollback and audit/timeline attribution.

## 4. Add safe admin route utilities

**Files**

- Reuse `apps/web/lib/platform.ts` and the existing staff-session/error helpers.
- Add a focused customer request parser under `apps/web/lib/` only if route parsing would otherwise
  be duplicated.
- Add unit tests beside any new parser/helper.

**Work**

- Parse and bound page, limit, sort, view, filters, selected IDs and tags.
- Map validation errors, not-found, duplicate email, forbidden consent and unexpected failures to
  safe status codes and messages.
- Keep database details, raw SQL errors and PII out of logs/responses.

## 5. Expand the canonical `/api/admin/customers` surface

**Files**

- Update `apps/web/app/api/admin/customers/route.ts` with GET and POST.
- Update `apps/web/app/api/admin/customers/[customerId]/route.ts` with GET and PATCH.
- Preserve and update the existing notes and tags routes.
- Add `apps/web/app/api/admin/customers/bulk-tags/route.ts`.
- Add `apps/web/app/api/admin/customers/export/route.ts`.
- Add route tests using the repository's current Next route-test pattern.

**Work**

- Require authenticated staff access for every read.
- Require OWNER/OPERATIONS-equivalent permission for profile/contact/consent/tag/note mutations.
- Validate all request bodies before invoking the domain service.
- Return stable JSON contracts for list/detail/form mutations.
- Return export as UTF-8 CSV with a safe filename and `Content-Disposition: attachment`.
- Audit successful PII exports without logging their contents.

**Verification**

- Test unauthenticated, read-only, malformed, duplicate, not-found and happy paths.
- Verify the CSV response headers, encoding and exact allowlisted column order.

## 6. Add browser preference support for Customers

**Files**

- Extend `apps/web/lib/admin-preferences.ts`.
- Extend `apps/web/lib/admin-preferences.test.ts`.

**Work**

- Add versioned, strictly parsed preferences for visible customer columns and last active fixed
  view.
- Preserve the existing sidebar preference contract.
- Fall back to the approved default columns when storage is absent, malformed or from an
  unsupported version.
- Never persist filters, customer data, selection or PII in localStorage.

**Verification**

- Test valid persistence, malformed JSON, stale versions, missing columns and unknown view names.

## 7. Build reusable customer admin components

**Files**

- Add focused components under `apps/web/app/admin/customers/_components/`, including:
  - `customer-metrics.tsx`;
  - `customer-views.tsx`;
  - `customer-toolbar.tsx`;
  - `customer-table.tsx`;
  - `customer-mobile-list.tsx`;
  - `customer-bulk-bar.tsx`;
  - `customer-form.tsx`;
  - `customer-timeline.tsx`; and
  - small contact/address/tags/design cards where reuse improves clarity.
- Add component tests beside interactive components using the current test stack.

**Work**

- Use semantic buttons, forms, tables and live regions.
- Keep URL search parameters authoritative for search/filter/sort/page.
- Ensure row navigation does not fire from checkboxes or action controls.
- Reset selection when page, view or filter identity changes.
- Make bulk tag dialogs keyboard/focus safe and preserve context after errors.
- Share one accessible Add/Edit form with inline errors and first-error focus.
- Use the established admin shell styles and icon system; do not create a second theme.

**Verification**

- Test keyboard activation, labelled selection, debounced search, URL updates, selection reset,
  dialogs, mutation pending states and local preference restoration.

## 8. Replace the Customers directory

**Files**

- Replace the wrapper implementation in `apps/web/app/admin/customers/page.tsx`.
- Add `apps/web/app/admin/customers/loading.tsx` and `error.tsx` if the route uses server loading.
- Update only the customer-specific/admin-shared sections of `apps/web/app/globals.css`, or add a
  scoped customer stylesheet following the repository convention.

**Work**

- Render the approved full-width B-metrics/A-columns layout.
- Connect metrics, fixed views, search, filters, sorting, columns, pagination and responsive rows to
  real API/domain results.
- Add functional Add customer and export actions.
- Add all-empty, filtered-empty, loading, error and retry states.
- Keep the desktop 32–48px gutters and expanded/collapsed sidebar behavior already approved.

## 9. Build Add and Edit customer pages

**Files**

- Add `apps/web/app/admin/customers/new/page.tsx`.
- Add `apps/web/app/admin/customers/[customerId]/edit/page.tsx`.
- Add route-level loading/error states where needed.

**Work**

- Use the shared form for overview, primary address, marketing, tags and internal note.
- Preserve values after server validation errors.
- Navigate a successful create to the new detail route with an accessible success notice.
- Navigate successful edit back to detail; Cancel performs no mutation.
- Link duplicate email conflicts directly to the existing profile.

## 10. Replace the Customer detail page

**Files**

- Replace the operations-component wrapper in
  `apps/web/app/admin/customers/[customerId]/page.tsx`.
- Retire admin usage of
  `apps/web/app/ops/customers/[customerId]/operations-customer-detail.tsx` only after parity.

**Work**

- Implement the approved two-column commercial-first layout.
- Connect summary metrics, order links, timeline/note composer, contact/consent, address, tags,
  credits and design activity.
- Keep historical order data read-only and link Orders to canonical `/admin/orders` routes.
- Ensure Edit, Manage tags and Add note are functional; omit any unsupported More actions menu.
- Stack the right-side cards into a logical mobile order.

## 11. Legacy parity and cleanup

**Files**

- Update `/ops/customers` pages only after the new admin pages pass parity tests.
- Remove obsolete customer-only CSS and components only when no remaining route imports them.

**Work**

- Redirect replaced legacy list/detail routes to `/admin/customers` equivalents.
- Keep legacy APIs temporarily if another consumer still uses them; document and remove only proven
  dead paths.
- Run `rg` for stale `/ops/customers` links and update canonical admin navigation.

## 12. End-to-end verification

**Automated**

1. Run format and `git diff --check`.
2. Run focused customer contract, preference and component tests.
3. Run domain integration tests against the local PostgreSQL service.
4. Run `pnpm db:verify`.
5. Run full `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.

**Browser QA**

1. Verify Customers at desktop widths with sidebar expanded and collapsed.
2. Verify each fixed view, search, combined filters, sort, columns persistence and pagination.
3. Select rows, add/remove tags, export selected CSV and confirm selection reset rules.
4. Create a customer with and without an address; verify duplicate email and validation errors.
5. Edit profile/address/consent and confirm detail/timeline refresh.
6. Open orders, add a note and manage tags from detail.
7. Verify empty, filtered-empty, loading, API failure, forbidden and not-found states.
8. Verify keyboard-only operation, focus return and live feedback.
9. Check tablet/mobile responsive behavior separately. Do not report physical-device verification
   unless a physical device was actually used.

## 13. Commit sequence

Use small, reviewable commits that do not absorb unrelated dirty-worktree changes:

1. customer profile/address migration and contracts;
2. domain queries, mutations and tests;
3. protected admin customer APIs and tests;
4. customer admin components and preferences;
5. directory and Add/Edit pages;
6. detail page, legacy parity and styling;
7. verification fixes and documentation updates.

Do not push until explicitly requested. Before every commit, inspect the staged diff and stage only
files belonging to that slice.
