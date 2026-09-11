# Shopify-like customer management — Customers slice

## Status and relationship to earlier work

This specification replaces the Customers section of the ecommerce admin foundation and extends
the earlier unified-customer design with the subsequently approved visual direction and functional
scope. It covers `/admin/customers`, customer detail, customer creation and customer editing. It
does not redesign Orders, Products, Analytics or Settings.

The approved visual direction combines the commerce-intelligence summary from direction B with
the practical directory columns from direction A. Customer detail and customer creation use the
same quiet, Shopify-like admin system: full-width desktop content, restrained white cards, compact
data density, neutral surfaces, clear hierarchy and no technical/provider-oriented information.

## Goals

- Let staff understand the commercial value and recent activity of the customer base at a glance.
- Make individual customer support work fast: contact details, address, orders, tags, notes,
  credits and design activity are available in one profile.
- Let authorized staff create and edit customer profiles without creating an account on the
  customer's behalf.
- Support useful fixed segments, bulk tagging and selected-customer CSV export.
- Store marketing consent explicitly and audibly; never infer it from an order or checkout.
- Preserve the existing normalized-email identity model, order history, credit history and staff
  authorization boundaries.

## Deliberate exclusions

This slice does not include CSV import, custom segment/query creation, campaign sending, tax
exemptions, company/B2B fields, customer merging, deletion, account impersonation or external CRM
sync. No inactive buttons or placeholder destinations for those features are shown.

## Chosen implementation approach

Extend the existing durable `customer_profiles` read/write model and current customer operations
service. The admin UI and API continue to use canonical store data rather than a parallel CRM or
client-side fixtures.

Two alternatives were rejected:

1. A UI-only redesign over the current fields cannot provide functional customer creation,
   editable contact information or truthful marketing consent.
2. A separate CRM service/schema would duplicate identity, order and address data and add
   operational complexity that the current store does not need.

The chosen approach keeps changes focused while providing a safe base for future editable
segments and imports.

## Information architecture and routes

- `/admin/customers` — customer metrics, fixed saved views, filters and selectable directory.
- `/admin/customers/new` — dedicated Add customer page.
- `/admin/customers/[customerId]` — customer profile.
- `/admin/customers/[customerId]/edit` — edit contact, address and marketing settings using the
  same form vocabulary as Add customer.

Legacy `/ops/customers` routes remain available until functional parity is verified. After parity,
they redirect to the canonical `/admin` routes; they do not retain a second visual system.

## Customer directory

### Header and metrics

The page header contains **Customers**, a CSV Export action and the dominant **Add customer**
action. Four server-owned metrics sit below it:

- total customers;
- returning-customer percentage;
- average lifetime spend among customers with at least one paid order; and
- email subscribers.

Unavailable metrics display an em dash and explanatory accessible text, not a fabricated zero.

### Fixed saved views

The first release contains five system views:

- **All** — every customer profile;
- **New** — profiles first seen within the last 30 days;
- **Returning** — profiles with at least two paid, non-test orders;
- **High value** — profiles with at least USD 150 in paid, non-refunded lifetime spend; and
- **Email subscribers** — profiles whose explicit email marketing status is `SUBSCRIBED`.

These definitions live server-side and are not editable in this slice. The high-value threshold is
a named domain constant so a later Settings implementation can replace it without changing the
query contract.

### Toolbar and table

The toolbar contains one debounced search field plus Filters, Sort and Columns controls. Search
matches profile name, normalized email, phone and address text. Supported filters are location,
email subscription, SMS subscription, tags, order count, total spend and last-order date. Filters
and sorting are encoded in the URL so the view can be refreshed or shared internally.

Initial desktop columns are:

1. selection checkbox;
2. Customer — name with email below;
3. Email subscription;
4. Location;
5. Orders;
6. Amount spent;
7. Last order; and
8. Tags.

Customer is locked. Optional columns can be hidden or restored. The visible-column selection and
last selected system view are staff-device preferences stored in versioned `localStorage`, matching
the approved sidebar preference behavior. Data, filters and authorization never depend on that
storage.

Rows navigate to customer detail except when the user interacts with selection or another row
control. Pagination is server-owned. Narrow screens become structured linked rows rather than an
unusable horizontally compressed table.

### Selection and bulk actions

Staff can select individual customers or all customers on the current page. Selection contains
explicit customer IDs, is limited to the current loaded page and clears when the page, saved view
or filters change. The contextual bulk bar supports:

- Add tags;
- Remove tags; and
- Export selected.

Tag updates are transactional and report how many selected profiles changed. Export returns a CSV
containing customer name, email, phone, location, consent states, orders, amount spent, last order
and tags. Because this is a PII-bearing action, it requires the authorized staff role and creates an
audit event. No provider identifiers, payment data, private asset URLs or authentication data are
exported.

## Customer detail

The detail header contains a back link, initials/avatar, customer name, customer-since context and
a functional **Edit customer** action. The body uses a two-column desktop layout.

The wider left column contains:

- commercial summary: amount spent, orders, average order value and available design credits;
- recent orders with order number, date, item count, fulfillment/payment-safe status and total;
- a link to the complete filtered Orders view; and
- timeline with internal note composer and human-readable lifecycle events.

The right column contains:

- customer contact card: email, phone, email consent and SMS consent;
- default address;
- editable tags; and
- design activity: saved-design count and most recent design date.

Historical order snapshots remain immutable. Editing the profile does not rewrite an old order's
delivery, billing or recipient data. Credit ledger details remain accessible below the primary
commerce information when needed but do not dominate the page.

## Add and edit customer

Add customer is a dedicated page, not a modal, because address, consent, tags and note require
enough space for clear validation. It contains:

- Customer overview: first name, last name, email and phone;
- Primary address: country/region, address, optional apartment, city, state/province and postal
  code;
- Marketing: separate email and SMS consent checkboxes;
- Tags; and
- Internal note.

Email is required, normalized and unique because it remains the canonical customer identity key.
Names, phone, address, tags and note are optional. If any address field is entered, country,
address, city and postal code become required as a coherent group. Phone input is normalized when
possible and otherwise rejected with an inline message.

Saving creates a customer profile without creating login credentials or sending customer-facing
messages. A duplicate normalized email produces a safe inline conflict with a link to the existing
profile. Successful creation navigates to the new customer detail page and shows an accessible
success notice.

Edit customer reuses the form and updates only the durable profile/contact/default-address fields.
It does not alter the canonical normalized email without a separate conflict check. Cancel returns
without persisting changes.

## Consent semantics

Email and SMS each use `UNKNOWN`, `NOT_SUBSCRIBED` and `SUBSCRIBED` states. Existing reconciled
profiles start at `UNKNOWN`. A checked Add/Edit control writes `SUBSCRIBED`; an explicitly unchecked
saved control writes `NOT_SUBSCRIBED`. Each change records timestamp, staff actor and source
`ADMIN`. Purchases, checkout capture and account creation never opt a customer into marketing.

Privacy suppression remains authoritative: a suppressed subject cannot be set to `SUBSCRIBED`
until the separate privacy rule permits it. The UI explains the blocked action without exposing
internal identifiers.

## Data model

Add focused durable fields to `app.customer_profiles`:

- `first_name`, `last_name`, `phone`;
- `email_marketing_status`, `email_marketing_updated_at`;
- `sms_marketing_status`, `sms_marketing_updated_at`; and
- normal timestamps already used by the profile.

Create `app.customer_addresses`, keyed by `customer_profile_id`, with recipient/contact and postal
fields plus one-default-address enforcement. This is required because manually created customers
may not have a `user_id`; existing `saved_addresses` is account-owned. Reconciliation can read an
account's current saved address as a fallback, but a customer-profile address becomes the admin
record once explicitly created or edited.

Existing tags, timeline events, orders, credit ledger and projects remain the authoritative linked
sources. Migration/backfill is idempotent and leaves unknown values null/`UNKNOWN` rather than
inventing consent or contact data.

## Domain and API boundaries

The customer operations service owns validation, identity normalization, view definitions,
commercial aggregation and mutations. Browser components do not calculate authoritative spend,
order counts, consent or segment membership.

Admin routes:

- `GET /api/admin/customers` — paginated directory, summary metrics and allowed filters/view;
- `POST /api/admin/customers` — create profile;
- `GET /api/admin/customers/[customerId]` — customer detail;
- `PATCH /api/admin/customers/[customerId]` — edit profile, address and consent;
- `POST /api/admin/customers/[customerId]/notes` — add internal note;
- `POST /api/admin/customers/[customerId]/tags` — replace tags;
- `POST /api/admin/customers/bulk-tags` — add or remove tags from explicit IDs; and
- `POST /api/admin/customers/export` — export explicit IDs or the currently authorized filtered
  result as CSV.

Read access uses the existing staff customer permission. Profile, tag, note and consent mutations
remain limited to OWNER/OPERATIONS-equivalent roles. Exports require the same protected admin
context and are audited. Every payload uses allowlisted fields, bounded arrays and safe error
serialization.

## Component boundaries

- `AdminCustomersPage` coordinates URL state, summary and directory requests.
- `CustomerMetrics` renders the four read-only commercial metrics.
- `CustomerViews` renders fixed views and their active state.
- `CustomerToolbar` owns search/filter/sort/column UI but not data computation.
- `CustomerTable` owns accessible rows, responsive presentation and selection events.
- `CustomerBulkBar` owns selected-ID actions and their scoped pending/error feedback.
- `AdminCustomerDetail` composes summary, orders, timeline and side cards.
- `CustomerForm` is shared by Add/Edit and produces one validated API payload.
- Small focused cards handle contact, address, tags, design activity and timeline independently.

No single page component owns SQL, domain rules or unrelated admin shell behavior.

## Loading, empty and error states

- Directory loading uses stable table/metric skeletons; filters remain visible.
- A store with no customers receives an Add customer empty state.
- A filtered search with no matches retains filters and offers Clear filters.
- Detail not-found and unauthorized responses are distinct safe pages.
- Mutations disable only their initiating action and preserve entered values after failure.
- Bulk partial success is not allowed: tag mutations commit all selected IDs or none.
- Export failure stays on the page with a retryable accessible notice.
- Form validation is inline, summarized at the top on submit and moves focus to the first invalid
  field.

## Accessibility and responsive behavior

All fields have persistent labels, errors are associated with inputs, dialogs return focus to the
trigger and selection checkboxes have customer-specific accessible names. Saved views and table
sorting are keyboard operable. Status is never communicated by color alone. Desktop remains the
primary admin target, while tablet/mobile retain complete functionality using stacked cards and a
responsive form.

## Verification

### Domain and database

- Migration and schema verification for profile fields, address constraints and status values.
- Unit/integration tests for email normalization, duplicate detection, address group validation,
  consent auditing, privacy suppression, fixed view membership and commercial totals.
- Transaction tests for add/remove bulk tags and profile/address creation.
- CSV tests for escaping, allowlisted columns, selected IDs, filtered export and authorization.

### API and UI

- Route tests for unauthenticated, unauthorized, invalid and conflict cases.
- Component/browser tests for search, saved views, filters, sorting, columns persistence,
  pagination, row navigation, selection reset and bulk actions.
- Add/Edit tests cover success, preserved input on errors, duplicate email and consent states.
- Detail tests cover orders, notes, tags, addresses, timeline and responsive card order.
- Manual desktop review verifies full-width layout, keyboard navigation, focus management and CSV
  download. Tablet/mobile responsive behavior is checked separately and is not described as a
  physical-device pass unless actually tested on hardware.

### Repository checks

Format, lint, typecheck, focused customer tests, database verification, full tests and production
build must pass before delivery.

## Acceptance criteria

- Customers reads as an ecommerce customer workspace rather than a technical operations screen.
- The approved B-metrics/A-columns directory is implemented with real server-owned data.
- All five fixed views return customers according to the explicit definitions in this spec.
- Add customer, Edit customer, tags, notes, selection, bulk tagging and CSV export are functional.
- Customer detail prioritizes orders, spend and human context while retaining credits and design
  activity.
- Marketing consent is explicit, auditable and never inferred from commerce activity.
- Local preferences persist for columns and active view; business data does not live in
  `localStorage`.
- No dead controls, fake production values, provider internals or weakened authorization ship.
