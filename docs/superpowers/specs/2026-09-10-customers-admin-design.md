# Customers admin — unified customer base

## Purpose

Add a Shopify-admin-inspired Customers area to the authenticated internal operations workspace. It gives staff one safe, operational view of every person known to the store, regardless of whether the person created an account.

## Customer identity

The canonical customer key is a normalized email address. A person becomes a customer at the first valid email touchpoint:

- passwordless sign-in or account creation;
- newsletter consent;
- checkout email capture, including an abandoned checkout; or
- completed order.

There are no customer categories, tabs, or labels that distinguish a registered account from an order customer. Account ownership enriches a customer profile but never excludes a guest customer from the directory. Existing order history is associated with the normalized email; a later verified account with the same email enriches that same profile rather than creating an operational duplicate.

## Routes and navigation

- `/ops/customers` is a full-width customer directory. On desktop it fills the entire main window to the right of the persistent operations sidebar.
- Selecting a row navigates to `/ops/customers/:customerKey`; it never opens a split pane.
- The detail page contains a clear back link to the directory. On mobile, the current compact operations header remains and each route is full width.

The shared sidebar gains **Customers** under Store management. The directory and detail page use the existing Operations visual system: neutral canvas, white table/card surfaces, compact Shopify-like data density, blue linked identities, quiet status chips, and the Let It Be brand rather than Shopify artwork or markup.

## Customer directory

The default view contains every known customer. It offers:

- search by name, email, phone, and saved/delivery address;
- sortable, paginated rows;
- filters that the backend can truthfully compute: order count, total spent, last order date, design-credit balance, location, marketing consent, and tags;
- user-configurable visible columns, with Customer locked as the first column; and
- CSV export restricted to the authorized staff role.

The initial desktop columns are Customer, Orders, Total spent, Design credits, and Last order. On narrow screens the table becomes linked compact rows and retains the customer, key commercial summary, and last-order information.

Customer segments are a subsequent slice. The directory architecture must support saved, rule-based segments later, but this slice does not expose a custom query editor, campaign sending, or external email synchronization.

## Customer profile

`/ops/customers/:customerKey` has these sections:

1. **Identity header** — name, email, customer-since date, and staff actions.
2. **Commercial summary** — total spent, number of orders, available design credits, and last order date.
3. **Orders** — linked order history with fulfillment state and totals.
4. **Customer details** — phone, saved/default address, account data when it exists, saved-design count, and recorded consent states.
5. **Credit history** — ledger entries with amounts, before/after balances, timestamps, and reasons.
6. **Internal timeline** — staff notes and relevant, safely auditable customer lifecycle events. It is never customer-visible.
7. **Tags** — staff-managed, customer-safe labels that can later power filters and segments.

Names, phone numbers, email addresses, addresses, and consent must display their source and update only through an explicit customer-profile edit flow. Order snapshots stay immutable: changing a profile does not rewrite historical order records.

## Data model and operations boundaries

Create an operations-only customer read model that consolidates existing data from `users`, `account_profiles`, `saved_addresses`, `orders`, `credit_accounts`, `credit_ledger`, `projects`, and `customer_notes` by normalized email. It also records first/last touchpoint timestamps and the source responsible for an initially created profile.

The implementation may introduce a durable internal customer-profile table to make a canonical customer ID, touchpoint provenance, tags, staff notes, and future merge operations safe. It must backfill and reconcile existing account/order records idempotently. It must not duplicate payment details, Printify data, private asset URLs, authentication tokens, or provider credentials.

Staff mutations are limited to tags and internal notes in this slice. Customer PII editing, profile merging, marketing sends, deletion, and export delivery mechanics need their own audited workflows; the UI may not imply they are available before they are implemented.

## APIs and authorization

Operations-only endpoints are added under `/api/ops/customers`:

- `GET /api/ops/customers` for safe filtered/paginated directory results;
- `GET /api/ops/customers/:customerKey` for the profile read model;
- `POST /api/ops/customers/:customerKey/notes` for internal notes; and
- `POST /api/ops/customers/:customerKey/tags` for tag updates.

The endpoints require the existing `ADMIN` or `CX_OPS` session checks. The response exposes only data necessary for staff support and operations. All mutations validate inputs, serialize safe error messages, and write an internal audit event.

## States and error handling

The directory and profile use loading, empty, unauthorized, not-found, and safe inline error states consistent with Orders. A search with no matches explains that no customer matched, rather than suggesting that no account exists. Note/tag mutations disable only their own control while pending and refresh the relevant profile data after success.

## Validation

- Domain and route tests cover email normalization, account/order consolidation, PII-safe authorization, pagination/filter validation, and idempotent reconciliation.
- UI tests cover directory search/filter states, desktop row navigation, mobile drill-in/back navigation, and note/tag feedback.
- Existing account, credit, commerce, privacy, and operations tests continue to pass.
- Type checks, linting, and a production web build pass before delivery.
