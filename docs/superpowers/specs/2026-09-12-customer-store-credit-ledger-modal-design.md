# Customer Store Credit Ledger Modal Design

## Scope

Add a read-only Store Credit ledger modal to the admin customer detail page (CDP). The existing adjustment pencil remains the entry point for manual credit and debit adjustments. This change does not add a new admin route and does not change Design Credits.

## Store Credit card states

The card must distinguish account balance from transaction history:

- When the customer has no Store Credit ledger entries, show `-` and do not render a ledger chevron.
- When at least one ledger entry exists, show the USD balance and render a chevron. A zero balance after prior activity must be shown as `$0.00 USD`, not as `-`.
- The adjustment pencil remains visible and independently clickable in every state.
- The chevron must have an accessible label and must not trigger the adjustment modal.

The presence of transaction history must be derived from `app.store_credit_ledger`, never inferred from the current balance.

## Ledger modal

Selecting the chevron opens a clean modal over the CDP, preserving the current customer context. The modal follows the information hierarchy of Shopify's Store Credit activity view while matching the existing admin visual system.

The modal contains:

- customer identity and `Store credit` title;
- current USD balance;
- a read-only transaction table with date/time, event, source or actor, debit, credit, and resulting balance;
- the adjustment reason and optional note as supporting transaction detail;
- an `Adjust balance` action that opens the existing Store Credit adjustment modal;
- close button, backdrop dismissal, and Escape-key dismissal;
- loading, empty, and error states.

Credit entries populate the Credit column and debit entries populate the Debit column. All monetary values use USD formatting and each row shows the authoritative `balance_after_cents` value.

## Data and pagination

Expose a dedicated authenticated admin ledger read endpoint rather than reconstructing the ledger from the general customer timeline. The endpoint reads `app.store_credit_accounts` and `app.store_credit_ledger`, orders entries newest first with a deterministic ID tie-breaker, and returns:

- current balance and currency;
- total transaction count;
- a page of ledger entries;
- page and page-size metadata.

The modal uses internal pagination with 20 transactions per page. Refreshing the customer after an adjustment must update the card state, displayed balance, transaction count, and subsequently opened ledger.

## Error handling and security

- Require the existing authenticated admin session and customer access rules.
- Return `404` for an unknown customer and validation errors for invalid pagination.
- Show an inline retryable error inside the modal without closing it.
- Never expose another customer's entries.

## Verification

Automated coverage must prove:

- no entries renders `-` and no chevron;
- one or more entries renders the formatted balance and chevron, including a zero balance;
- the API returns deterministic paginated ledger data and enforces admin authentication;
- debit, credit, reason, note, actor, timestamp, and balance-after values map correctly;
- modal open, close, pagination, loading, error, and transition-to-adjustment behavior work;
- existing Store Credit adjustment and customer timeline behavior do not regress.

Run format, lint, typecheck, focused tests, the complete test suite, and build before completion.
