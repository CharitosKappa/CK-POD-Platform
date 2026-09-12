# Store Credit and Design Credits Separation

## Outcome

The customer detail page distinguishes two unrelated balances:

- **Design Credits** are integer units purchased or granted for successful design generation.
- **Store Credit** is monetary value credited to a customer after a return, promotion, or manual customer-service decision.

The balances must never share tables, units, mutation services, or UI labels.

## Customer detail layout

The commercial summary at the top contains Amount spent, Orders, Average order, and Return rate. The existing Credits metric is removed.

The right sidebar is ordered as follows:

1. Contact information
2. Design Credits
3. Store Credit
4. Tags
5. Notes

The Design Credits card shows the existing generation-credit balance as an integer, such as `4 credits`. It is read-only in this slice. The Store Credit card shows the live monetary balance as USD, such as `$25.00 USD`, and includes a pencil action.

All user- and admin-visible copy for generation credits uses the full label `Design Credits`. Existing internal `credit_accounts`, `credit_ledger`, `CreditService`, and `/api/credits` contracts remain unchanged to avoid a risky compatibility migration. The new monetary subsystem uses explicit `store_credit_*` names throughout.

## Store Credit persistence

Add two independent tables:

### `store_credit_accounts`

- one account per customer profile;
- fixed `USD` currency for the USA store;
- non-negative `current_balance_cents` projection;
- created and updated timestamps.

### `store_credit_ledger`

- immutable entry identifier;
- owning Store Credit account;
- signed, non-zero `amount_cents`;
- non-negative `balance_after_cents`;
- reason category: `REFUND`, `PROMOTION`, `CUSTOMER_SERVICE`, or `OTHER`;
- optional bounded staff note;
- required staff actor;
- required client idempotency key, unique per account;
- creation timestamp.

The ledger is the source of truth. The account balance is a locked convenience projection updated in the same database transaction.

Store Credit does not expire in this slice. Applying Store Credit during checkout and automatically issuing it from the refund workflow are separate future changes.

## Adjustment operation

An operations-authorized staff member can create a manual adjustment from the customer detail sidebar.

The service transaction:

1. validates the customer, amount, reason, note, and idempotency key;
2. creates the account at zero when it does not exist;
3. locks the account row;
4. rejects a debit greater than the available balance;
5. updates the projected balance;
6. appends one immutable ledger entry;
7. returns the resulting balance.

Repeating the same idempotency key returns the original result without applying the amount twice. A debit can reduce the balance to zero but never below zero.

## Admin API and authorization

The customer detail response includes:

- `storeCreditBalanceCents`;
- `storeCreditCurrency`;
- recent Store Credit ledger entries for timeline composition.

`POST /api/admin/customers/:customerId/store-credit-adjustments` accepts:

- `direction`: `CREDIT` or `DEBIT`;
- a positive decimal USD amount;
- a reason category;
- an optional note;
- an idempotency key.

The route requires the existing authorized admin session. Read-only staff cannot create adjustments. Validation and concurrency rules live in the domain service, not the React component.

## Adjustment modal

The Store Credit pencil opens `Adjust store credit`, following the existing customer-detail modal treatment.

The modal contains:

- a two-state `Add credit` / `Deduct credit` control;
- a disabled `USD` currency field;
- a decimal amount field;
- a required reason selector;
- an optional internal note;
- Cancel and context-aware `Add credit` or `Deduct credit` actions.

The action remains disabled until the amount is positive and a reason is selected. Server errors stay inside the modal. On success, the modal closes, the customer detail reloads, and a restrained confirmation message appears.

No non-functional expiry or customer-notification controls are shown.

## Timeline and auditability

Each Store Credit ledger entry is mapped into the unified customer timeline with:

- credit or debit direction;
- signed USD amount;
- resulting balance;
- reason and optional note;
- staff actor;
- timestamp.

This is derived directly from the ledger, so the timeline cannot drift from the financial record.

## Typography correction

Contact Information metadata uses one shared typography rule. Default address, the notification-language sentence, Marketing subscriptions, Tax details, and their values share the same compact font size and line height. Section headings retain weight for hierarchy without increasing their size. No broad global element selector may override these card-specific tokens.

## Verification

Automated coverage must prove:

- Store Credit and Design Credits are returned as separate values;
- credit and debit adjustments update account and ledger atomically;
- duplicate idempotency keys do not double-apply;
- overdrafts and invalid decimal amounts are rejected;
- unauthorized staff cannot mutate Store Credit;
- Store Credit entries appear in the unified timeline;
- the Credits top metric is absent;
- Design Credits precedes Store Credit in the sidebar;
- the Store Credit modal posts the correct adjustment contract;
- customer sidebar typography uses the shared metadata treatment;
- format, lint, typecheck, unit tests, database integration tests, and production build pass.
