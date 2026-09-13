# Customer Marketing Consent States Design

**Date:** 2026-09-13
**Status:** Approved direction; implementation pending

## Goal

Replace the ambiguous customer marketing status model with the three customer-facing states used by the store:

- `NOT_SUBSCRIBED`: the customer has never granted consent;
- `SUBSCRIBED`: the customer currently has active consent; and
- `UNSUBSCRIBED`: the customer previously granted consent and later withdrew it.

Email and SMS keep independent states. Transactional-message eligibility remains separate from promotional marketing consent.

## State transitions

New customer profiles default to `NOT_SUBSCRIBED` for both channels. Checkout, account creation, and purchases must not opt a customer into marketing unless the customer explicitly selects the relevant opt-in.

For each channel, the supported transitions are:

- `NOT_SUBSCRIBED` to `SUBSCRIBED` after explicit opt-in;
- `SUBSCRIBED` to `UNSUBSCRIBED` after explicit withdrawal;
- `UNSUBSCRIBED` to `SUBSCRIBED` after a new explicit opt-in; and
- saving an unchanged unchecked control preserves `NOT_SUBSCRIBED` or `UNSUBSCRIBED` rather than collapsing the states.

Only `SUBSCRIBED` is eligible for promotional messages. Existing privacy suppression remains authoritative and can block a transition to `SUBSCRIBED`.

## Data migration

The database constraints and defaults for email and SMS marketing statuses will change from `UNKNOWN | NOT_SUBSCRIBED | SUBSCRIBED` to `NOT_SUBSCRIBED | SUBSCRIBED | UNSUBSCRIBED`.

Migration rules:

1. Convert existing `UNKNOWN` values to `NOT_SUBSCRIBED`.
2. For a current `NOT_SUBSCRIBED` value, inspect durable consent timeline history for that channel. If an earlier `SUBSCRIBED` state exists, migrate the current value to `UNSUBSCRIBED`.
3. Preserve current `SUBSCRIBED` values.
4. Do not synthesize consent events during migration; the migration itself remains traceable through the schema migration history.

This provides a conservative, deterministic backfill without inventing active consent.

## Domain and API behavior

The domain service owns the transition rules. Browser code may request a subscription change, but it must not decide whether an unchecked state means `NOT_SUBSCRIBED` or `UNSUBSCRIBED`.

Customer create, edit, list, detail, export, and filtering contracts will accept the new three-state enum. Consent updates will record, per changed channel:

- previous state;
- new state;
- source;
- timestamp; and
- staff/user actor where available.

Existing subscriber metrics and the Email subscribers view continue to include only `SUBSCRIBED` customers.

## Admin interface

The Customers list and filters display exactly:

- Subscribed
- Not subscribed
- Unsubscribed

The previous dash and `Unknown` option are removed. Customer detail controls retain a simple opt-in checkbox, while the server preserves the correct historical unchecked state. The customer timeline describes explicit subscribe, unsubscribe, and re-subscribe events using readable labels.

Exports emit the three explicit status values so downstream marketing tools can distinguish customers who never opted in from customers who opted out.

## Compatibility and safety

- No customer is treated as subscribed by migration inference.
- Promotional sends continue to require an exact `SUBSCRIBED` state.
- Transactional emails are unaffected by this marketing-consent change.
- Email and SMS histories cannot overwrite each other.
- Existing customer UUIDs, orders, balances, addresses, locale, tags, and other profile data remain unchanged.

## Verification

Automated coverage will prove:

- the three allowed statuses and rejection of removed `UNKNOWN` input;
- default creation as `NOT_SUBSCRIBED`;
- subscribe, unsubscribe, and re-subscribe transitions;
- preservation of an unchanged unchecked state;
- migration/backfill behavior with and without prior subscription evidence;
- correct list labels, filters, exports, detail rendering, and timeline metadata;
- subscriber metrics include only active subscribers; and
- privacy-suppressed customers cannot be subscribed.

Format, lint, typecheck, unit tests, integration tests with PostgreSQL, and the production build must pass before completion is reported.
