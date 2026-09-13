# Customers Final Hardening Implementation Plan

> **For agentic workers:** Execute this plan inline with test-driven development. Do not commit or push until the user explicitly requests it.

**Goal:** Remove the obsolete operations UI, close the remaining Customers accessibility/API/authorization/scalability gaps, and replace polluted local customer data with 20 curated development fixtures.

**Architecture:** The ecommerce-oriented `/admin` area becomes the only staff UI. Customer list queries use validated inputs, role-aware export loading, trigram-assisted search, and set-based order summaries. A guarded development-only reset script owns customer fixture replacement.

**Tech Stack:** Next.js App Router, React 19, TypeScript, PostgreSQL, Vitest, pnpm.

**Spec:** User-approved review decisions from 2026-09-13.

## Global Constraints

- Delete the `/ops` UI and `/api/ops` route trees; do not redirect them.
- Do not migrate legacy email-keyed notes in this development phase.
- Do not change the current admin sign-in return path.
- Do not commit or push in this phase.
- The customer reset must reject non-local and integration-test databases.

### Task 1: Remove obsolete operations routes

- [ ] Delete every file under `apps/web/app/ops` and `apps/web/app/api/ops`.
- [ ] Search the active codebase for remaining `/ops` route references.
- [ ] Verify the Next.js build has no references to the deleted modules.

### Task 2: Complete address modal accessibility

- [ ] Add failing unit coverage for focus-loop selection logic.
- [ ] Add initial focus, editor focus, Tab/Shift+Tab trapping, and focus restoration.
- [ ] Verify the behavior in a live desktop browser.

### Task 3: Validate customer list and customer-order query inputs

- [ ] Add failing route coverage for malformed integer parameters.
- [ ] Add failing domain coverage for malformed `customerId` order filters.
- [ ] Map invalid client inputs to HTTP 400 without querying PostgreSQL.

### Task 4: Gate export status by staff capability

- [ ] Add failing coverage for the export visibility/load policy.
- [ ] Prevent READ_ONLY staff from rendering or polling the export surface.

### Task 5: Scale customer directory search and summaries

- [ ] Add failing SQL-shape tests for set-based order summaries and indexable search predicates.
- [ ] Replace per-customer order summary lateral scans with grouped CTE summaries.
- [ ] Add PostgreSQL trigram indexes for customer identity and address search fields.
- [ ] Apply and verify the migration locally.

### Task 6: Reset local customer fixtures

- [ ] Add failing tests for the local-database safety guard and the exact 20-customer fixture set.
- [ ] Add a guarded `customers:reset-dev` script.
- [ ] Delete all existing local customer profiles and dependent customer records inside one transaction.
- [ ] Create 20 curated US customer profiles with varied addresses, marketing states, tags, notes, and activity dates.
- [ ] Run the script and verify exactly 20 customers are visible.

### Task 7: Final verification

- [ ] Run format, lint, typecheck, unit/component tests, isolated integration tests, DB verification, and production build.
- [ ] Browser-smoke Customers list, CDP, READ_ONLY export visibility, and address modal focus behavior.
- [ ] Confirm changes remain uncommitted and unpushed.
