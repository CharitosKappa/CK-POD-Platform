# Customers Follow-up Hardening Design

## Goal

Finish the remaining customer-management hardening without changing the approved Shopify-like visual direction.

## Address book

Customer-owned addresses in `app.customer_addresses` become independently manageable. Staff with OWNER or OPERATIONS access can add, edit, remove, and choose the default address from one modal. The first customer-owned address becomes default automatically. Changing the default clears the previous default in the same transaction. Removing the default promotes the most recently updated remaining customer-owned address. Saved-account and historical-order addresses remain read-only fallbacks and are clearly identified as such.

Each mutation writes a dedicated customer timeline event with enough metadata to explain what changed. Address IDs are validated as UUIDs and scoped to the customer in every query. READ_ONLY staff can view addresses but cannot mutate them.

## Shareable Customers list state

The URL owns search, view, sort, page, minimum-orders, subscription, and location filters. Valid URL values are restored on load and invalid values fall back safely. User changes update the current URL without a server navigation. Existing localStorage preferences remain the fallback for view and sort when the URL omits them; columns and sidebar state remain personal local preferences.

## Integration-test database isolation

`pnpm test:integration` resolves a database that is distinct from the supplied development database. `TEST_DATABASE_URL` is authoritative when supplied and must name a different database from `DATABASE_URL`. Otherwise the runner derives `<database>_test`, creates it locally if needed, applies migrations, then launches the integration suite with that isolated URL. A guard rejects identical development and test database names.

## Verification

Behavior is protected with domain, UI-state, and database-runner tests. Final verification includes formatting, lint, typecheck, unit/component tests, isolated integration tests, production build, database verification, and browser smoke tests.
