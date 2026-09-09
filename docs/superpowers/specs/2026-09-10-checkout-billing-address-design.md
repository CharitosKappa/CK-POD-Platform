# Checkout Billing Address Design

**Status:** Approved design  
**Date:** 2026-09-10

## Goal

Let a customer use a billing address that differs from the delivery address without changing the approved mobile checkout structure or allowing billing data to affect fulfillment.

## Customer experience

Delivery remains the single address section used to receive the shirt. It supplies the recipient, fulfillment destination, delivery quote, and destination tax calculation.

At the top of the existing Payment section, a checked-by-default control reads **Billing address is the same as delivery address**. While checked, the checkout uses the delivery details and takes no extra space. When unchecked, a compact **Billing address** form expands before the card fields. It contains first name, last name, address, optional apartment, city, state, and ZIP code.

The billing form uses billing-specific browser autofill tokens. Delivery keeps shipping-specific tokens. Toggling back to the default does not discard a partially entered billing address, so a customer can change their choice without retyping. The separate form is validated only while it is visible. Contact email remains a single Contact-section field and is used for receipts and order communication.

The existing delivery-address save checkbox continues to save only the delivery address to the customer's account. Billing addresses are never saved to the address book by this change.

## Boundaries

| Data or action | Source of truth | May use billing address? |
| --- | --- | --- |
| Delivery quote and carrier choice | Delivery address | No |
| Destination tax calculation | Delivery address | No |
| Print-provider fulfillment destination | Delivery address | No |
| Payment authorization / future AVS adapter boundary | Billing address | Yes |
| Receipt / customer communication | Contact email | No |
| Paid order record | Immutable delivery and billing snapshots | Yes |

No print provider, supplier, or technical print information appears in checkout.

## Domain and persistence design

`ShippingAddressInput` remains the existing cart-owned delivery form, including email, phone, and optional `saveToAccount` consent.

A new `BillingAddressInput` is a plain postal identity: recipient name, line one, optional line two, city, state, ZIP, and country. It intentionally excludes email, phone, and address-book consent.

`CommerceService.startCheckout` receives a structured request instead of separate positional address and idempotency arguments:

```ts
{
  shippingAddressId: string;
  billingAddress: BillingAddressInput | null;
  idempotencyKey: string;
}
```

`billingAddress: null` means the delivery address is the billing address. The server retrieves the cart-owned delivery address, creates the resolved billing snapshot server-side, and validates a supplied alternative billing address before creating a checkout attempt. A client cannot choose another cart's address or supply a partial billing address.

The checkout-start API accepts the same contract. Its former `addressId` field is retired in favor of `shippingAddressId`; no browser caller outside this repository is supported, so backward compatibility is not required.

The migration adds non-null `billing_address_snapshot jsonb` to `app.checkout_attempts` and `app.orders`. Existing rows are backfilled from their delivery-address snapshot before the columns are made non-null. New attempts persist the resolved billing snapshot. Paid orders copy the immutable billing snapshot from their checkout attempt alongside the existing delivery snapshot.

Tax, provisional shipping, fulfillment routing, saved delivery addresses, and order operations continue to consume only the delivery address. The payment intent contract gains the resolved billing identity so the eventual live payment adapter has a verified server-owned billing source. The deterministic fake-payment adapter accepts it without changing behaviour.

## Frontend integration

`apps/ux-prototype/app/create-experience.tsx` remains the visual source of truth. Its `CheckoutCompletionInput` receives `billingMatchesShipping` and the separate billing draft. `apps/web/app/production-create-experience.tsx` maps that input to the checkout API, using the existing delivery-address endpoint first and the new checkout-start payload second.

The older standalone `/checkout` client is updated to the same API contract so it cannot drift from the primary journey.

The first divergent shipping/billing selection remains available in local fake checkout. It neither changes the quote nor causes a real payment or fulfillment action.

## Validation, accessibility, and failure behaviour

- The toggle is a native labelled checkbox and works through touch, keyboard, and screen readers.
- The revealed billing fields are programmatically labelled and have correct `autocomplete="billing …"` hints.
- The main checkout submit remains blocked by native form validation when the alternative billing form is incomplete.
- The server repeats validation and returns a clear error for an invalid billing address, missing shipping address, stale/expired checkout, or unauthorized cart.
- An idempotent retry returns the existing checkout and cannot replace its billing snapshot.
- The UI preserves all entered delivery and billing values after a validation or network error.

## Verification

- Migration test: existing checkout attempts and orders receive billing snapshots equal to their shipping snapshots.
- Commerce integration tests: same-as-delivery, distinct valid billing address, invalid billing address, cross-cart address rejection, idempotent retry, order snapshot copy, and unchanged tax/shipping destination.
- Payment contract tests: fake and Stripe request boundaries receive a resolved billing address without browser card data crossing the server.
- UI tests/manual mobile pass: default collapsed state, expand/collapse, billing browser autofill names, form validation, error retention, and successful fake checkout.
- Run formatting, lint, typecheck, unit tests, integration tests with the database, and production build.

## Out of scope

- Saving or managing billing addresses in Account.
- Changing fulfillment destination, tax policy, shipping rates, or production provider configuration.
- Enabling live Stripe payment capture, real AI generation, or Printify/Monster Digital order submission.
