# Customers Admin Hardening Design

## Objective

Harden the approved Shopify-like Customers list and customer detail page without changing their visual direction. The pages must use stable customer identity, real paginated data, accurate commercial metrics, non-destructive mutations, and only information backed by an implemented mechanism.

## Scope

### Stable customer identity

- Orders gain an optional `customer_profile_id` foreign key.
- Existing orders are backfilled by normalized email.
- New orders are linked to the customer profile created or found during checkout/order touchpoint recording.
- Customer queries use `customer_profile_id` first and normalized email only for legacy rows that have no profile link.
- Editing a customer's email does not detach their historical orders.
- Customer reconciliation remains an explicit maintenance operation; list and detail reads do not mutate or scan the full customer dataset.

### Commercial metrics

- `totalSpentCents` represents net captured revenue: completed order totals minus successful refunds, clamped to zero per customer.
- Average order value uses net spend divided by completed order count.
- The previous ambiguous `Return rate` label becomes `Refunded order rate`, defined as the percentage of completed orders with at least one successful refund.
- Customer segments continue to use order-count lifecycle semantics. High-value filtering uses net spend.

### Timeline

- Timeline data is fetched from a dedicated endpoint with a server-side page size of 10.
- Events from customer notes, orders, order transitions, refunds, reprints, design credits, store credits, generations, and email deliveries are combined in SQL, ordered newest-first, and paginated before returning to the browser.
- The timeline groups the current page by calendar date.
- The Notes card reads an explicit latest-note field and never infers it from a capped timeline page.

### Data integrity and mutation behavior

- Customer tags are unique case-insensitively while retaining the first stored display casing.
- Updating the default customer address updates that address in place or creates it; it never deletes unrelated saved customer addresses.
- Address input includes recipient name and address phone so the admin does not silently discard them.
- Unsupported hardcoded tax/VAT copy is removed from the detail page until a real USA tax-profile model exists.
- Hardcoded order-source copy is omitted until order source is stored.

### Admin UX and permissions

- Customer list sort joins the other persisted table preferences in `localStorage`.
- Selection, customer name, and email remain visible while horizontally scrolling wide customer tables.
- Mutation controls are hidden or disabled for read-only staff; the API remains the final authorization boundary.
- Existing approved spacing, typography, cards, modals, sidebar, and responsive behavior remain intact.

## Migration and compatibility

Migration `0041_customer_hardening.sql` adds the order relationship and supporting indexes and backfills existing data. Migration `0042_customer_tag_canonicalization.sql` safely merges case-only tag duplicates and adds a case-insensitive unique tag index. Legacy orders with a null relationship remain readable through the normalized-email fallback.

## Validation

- Domain tests cover stable identity, net spend/refund semantics, case-insensitive tags, non-destructive addresses, and server-side timeline pagination.
- Component tests cover pagination/grouping and permission-aware/persisted presentation helpers where applicable.
- API route tests cover timeline validation and authorization.
- Run format check, lint, typecheck, targeted tests, full tests, integration tests against the local PostgreSQL service, and production build.

## Explicit non-goals

- No new tax engine or tax-exemption workflow.
- No configurable marketing segment builder.
- No new customer import system.
- No production data cleanup of local integration fixtures in this change.
- No visual redesign of the approved Customers experience.
