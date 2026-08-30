# Milestone 6 — Mockup, Cart & Checkout

Milestone 6 adds the platform-owned consumer commerce path from a passed or permitted-review prepress run to a paid platform order. It ends at the canonical `PAID` state. It does not route an order finally, create a Printify order, or submit production; those operations remain Milestone 7 work.

## Flow

`print-ready project/version → controlled prepress preview mockup → cart item → explicit immutable proof approval → validated US address → provisional shipping and tax snapshot → payment attempt → verified payment event → PAID order`

Cart items snapshot the exact project version, selected platform variant/color, prepress run, mockup, and product metadata. Changing the project version or color invalidates its approval. The proof uses only the controlled `PREPRESS_PREVIEW` asset; production masters, provider derivatives, source assets, and storage keys are never consumer-visible.

## Money and delivery

All authoritative money is integer USD cents. Platform product-variant retail pricing, a versioned development quantity-discount rule, a configurable free-shipping threshold, normalized provisional provider shipping cost, and `TaxService` produce an immutable checkout snapshot. Customer shipping revenue is separate from the provider shipping cost. A quote has an expiry; expired checkout attempts must be rebuilt before payment.

Development defaults to deterministic fake payment and tax services. Stripe PaymentIntents with automatic payment methods are enabled only by explicit server configuration. This supports card and Stripe-provided Apple Pay/Google Pay capability via Stripe Elements. Stripe Tax is optional; G4 is not completed by this integration. Legal wording hooks remain provisional under G5.

## Payment boundary

`PaymentService` owns fake/Stripe PaymentIntent creation and verified webhook parsing. Each checkout attempt has a persisted idempotency key; payment events are deduplicated by provider event ID; active cart attempts are unique. A verified success stores payment/order snapshots and sets the canonical order status to `PAID`.

The commerce domain imports no fulfillment creation/submission API. It only obtains a normalized **provisional** shipping estimate through the provider-neutral fulfillment contract. Payment success cannot call Printify order creation or production submission.

## Local testing

With `PAYMENT_ADAPTER=fake`, checkout can use `/api/checkout/:id/fake-confirm` to emit a deterministic signed fake payment event. This route is unavailable in Stripe mode and enters through the same verified payment-event persistence path. No real Stripe or Printify credentials are required for tests.
