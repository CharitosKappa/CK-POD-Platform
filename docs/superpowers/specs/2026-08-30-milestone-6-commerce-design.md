# Milestone 6 — Mockup, Cart & Checkout Design

## Scope and boundary

Milestone 6 implements the platform-owned consumer commerce path from a valid, prepress-ready design through a paid platform order. It covers controlled mockups, cart items, purchasable variants, quantity, immutable proof approval, address and shipping selection, tax and payment abstractions, checkout, payment webhooks, and consumer order confirmation.

It deliberately ends at the canonical `PAID` order state. Payment does not create a Printify order, submit production, finalize routing, or begin the Milestone 7 review workflow. G3, G4, G5, and G6 remain open as applicable.

## Architecture

The modular monolith gains a platform-owned commerce domain. Its public boundaries are:

- `MockupService` creates a consumer-safe proof from an immutable project version and prepress output. It never exposes a Production Master, provider derivative, private source asset, or storage key.
- `PricingService` calculates all USD prices in integer minor units from platform pricing configuration and writes versioned pricing snapshots. Browser totals are informational only.
- `ShippingService` normalizes provisional shipping quotes through the existing provider-neutral fulfillment boundary. A checkout quote is not a final routing decision.
- `TaxService` abstracts development tax behavior and the optional Stripe Tax adapter. It stores calculation references and audit detail without deciding US nexus or registration policy.
- `PaymentService` abstracts deterministic fake and Stripe PaymentIntent adapters. Route handlers and core order logic depend on this interface, not Stripe SDK calls.
- `CommerceService` coordinates ownership checks, version/prepress validation, proof approval, cart lifecycle, checkout idempotency, payment events, and platform order creation/update.

The database records carts and line items, mockup lineage, proof approvals, checkout attempts, shipping-address and quote snapshots, tax snapshots, pricing snapshots, platform orders/items, payment records, and deduplicated payment events. Payment data contains only provider identifiers, status, and operational metadata—never raw card data or secrets.

## Immutable proof and cart model

A cart item snapshots the canonical project, exact project version, selected platform product/color/variant, a prepress run, controlled mockup, and product metadata. Its proof approval includes the project, version, mockup/proof version, prepress reference, product/color state, actor ownership, and timestamp.

Any relevant project/version, product/color, mockup, or prepress mismatch invalidates approval. Checkout refuses hard prepress blockers. Prepress `PASSED` and explicitly permitted `REVIEW_REQUIRED` results may proceed; the existing production gate remains independent.

## Pricing, shipping, and tax

Pricing is server-authoritative and uses USD cents. It snapshots unit retail price, quantity discount, subtotal, customer shipping charge, free-shipping promotion application, tax, total, currency, and pricing-rule version. Provider shipping cost remains a separate internal financial input and is never presented as customer pricing.

Shipping options are normalized, customer-facing, freshness-tracked snapshots. Checkout revalidates an expired or changed quote and price/tax inputs before creating or confirming payment. If the amount changes materially, the client must receive the revised checkout state before charge confirmation.

Tax is supplied through `TaxService`. The default fake adapter supports deterministic development and CI behavior. Stripe Tax is optional/configured only. G4 remains an operational and legal gate; software configuration is not a claim of tax compliance. Legal checkout-policy hooks stay provisional under G5.

## Payment, order lifecycle, and idempotency

Each checkout attempt has a platform idempotency key. Replays, browser retries, provider retries, and duplicate webhooks reuse or safely resolve the same attempt. `PaymentService` creates an intent/session for the server-derived amount. Stripe (when configured) uses PaymentIntents and Stripe-supported wallet capability through the standard client integration; card checkout remains available when wallets are unavailable.

The verified, deduplicated provider webhook is authoritative for asynchronous settlement. A successful event creates or updates exactly one platform order and payment record, transitions the canonical order to `PAID`, and stores final payment/financial metadata when available. It has no reference to `FulfillmentService.createOrder` or `FulfillmentService.submitProduction`; no payment route, service, job, or webhook can invoke either method.

Pending, declined, cancelled, failed, and retryable outcomes preserve the cart and checkout attempt so the customer can retry safely. Consumer confirmation uses an opaque, non-sequential order number and says that payment was received and the order will be reviewed for production. It never claims production submission.

## Security and ownership

Guests retain ownership through the existing secure session mechanism; signed-in users use account ownership. Cart, proof, checkout, mockup, and order retrieval uniformly authorize the active user/session. Guest checkout stores only operationally necessary contact/address data and never weakens cross-session isolation. Customer order access exposes controlled proofs and order data only.

The system validates shipping addresses server-side and stores no raw card number, CVV, or payment credentials. Webhooks require provider verification before persistence. Consumer asset routes remain controlled-preview paths; private production and provider assets remain inaccessible.

## UX

The responsive checkout is a compact mobile-first flow:

`Review T-shirt → Size and quantity → Proof approval → Shipping → Payment → Confirmation`

It shows product/color, selected size, quantity, design preview, item subtotal, discount, shipping, tax, total, and an explicitly non-guaranteed delivery estimate. Consumer-facing prepress messages use plain language. The payment state clearly distinguishes ready, processing, pending, failed, and succeeded; success messaging stops at review for production.

## Verification

Automated unit and integration coverage will prove pricing arithmetic, discounts, free shipping, cart/order ownership, immutable proof invalidation, prepress blocking, controlled mockup security, fake payment outcomes, signed webhook behavior, payment idempotency, and the explicit absence of production submission after payment. Full repository format, lint, typecheck, tests, migrations, build, fake-payment, desktop, and mobile checkout smoke checks will run before the Milestone 6 report.
