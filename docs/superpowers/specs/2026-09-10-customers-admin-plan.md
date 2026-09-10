# Customers admin — implementation plan

## Slice boundary

Build the first operational Customers area: one unified directory, a dedicated customer profile route, internal notes, and staff tags. It consumes current account/order/credit data and does not activate a payment, Printify, AI, or external email provider. Rule-based saved segments, profile merge, staff PII editing, marketing sends, and deletion requests remain separate slices.

## 1. Canonical customer records and reconciliation

- Add a migration for `app.customer_profiles`, `app.customer_tags`, `app.customer_profile_tags`, and internal customer timeline/audit records.
- Give every profile a UUID and unique normalized email. Record first/last seen timestamps and the first known source (`ACCOUNT`, `CHECKOUT`, `ORDER`, or `NEWSLETTER`).
- Create an idempotent reconciliation path that upserts the canonical profile from existing users and orders before list/detail reads. It must never create duplicate profiles for case-variant copies of the same email.
- Extend passwordless identity and checkout/order creation to upsert the profile in their transaction or best-effort post-transaction workflow. Touchpoints without a current persistence source are not fabricated; newsletter and abandoned-checkout ingestion are prepared as explicit future adapters.
- Preserve historical order snapshots and do not copy payment credentials, provider tokens, or asset storage keys into customer records.

## 2. Operations customer service

- Add a focused `CustomerOperationsService` in the domain package rather than expanding the payment-oriented CX service.
- Implement `listCustomers()` with validated cursor/limit, search, sort, and filter parameters. Aggregate existing orders, user/account profile, saved addresses, credit account/ledger, saved designs, consent data when persisted, and tags.
- Implement `getCustomer()` with safe profile data, commercial summary, paginated orders, addresses, design summary, credit ledger, tags, and internal timeline.
- Implement `addCustomerNote()` and `replaceTags()` with input validation, operation-level authorization, and auditable events. Do not introduce staff editing of customer identity fields in this slice.
- Restrict all reads and mutations to `ADMIN` and `CX_OPS` using the existing session role guard.

## 3. Operations customer APIs

- Add `GET /api/ops/customers` for the directory and `GET /api/ops/customers/:customerId` for a profile.
- Add `POST /api/ops/customers/:customerId/notes` and `POST /api/ops/customers/:customerId/tags`.
- Maintain the existing safe `handleRouteError` response convention and validate all query/body values before reaching the service.
- Keep the earlier `/api/ops/cx` order lookup intact; optionally enhance it later to route customer searches to the new canonical results.

## 4. Responsive admin pages

- Add `Customers` to the shared `/ops` sidebar and compact mobile header navigation.
- Build `/ops/customers` as a full-width desktop table inside the existing main-window outlet. It includes search, server-supported filters, sort, compact count, pagination, loading/error/empty feedback, and a responsive mobile row representation.
- Build `/ops/customers/:customerId` as a separate main-window page with back navigation, identity header, commercial summary, order history, customer details, credit history, tags, and internal timeline.
- Implement notes/tags as small accessible interaction panels. Disable only the submitting control and refresh the profile after success.
- Do not show controls for export, merge, PII editing, or marketing sending until their backend workflows exist. The visual affordance must not imply an unavailable capability.

## 5. Tests and verification

- Add domain tests for email normalization, idempotent reconciliation, guest/account consolidation, aggregation correctness, tag/note authorization, and PII-safe outputs.
- Add route tests for authorization, validation, list pagination/filter behavior, and detail not-found behavior.
- Add focused client tests where current tooling allows; cover search/filter state, customer-row navigation, mobile drill-in/back navigation, and mutation feedback.
- Run the DB migration against the local test database, targeted domain suites, both relevant TypeScript checks, lint, `git diff --check`, and a production build of `apps/web`.
