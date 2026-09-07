# UX prototype — Cart loop after design review

## Goal

Let a shopper keep a completed custom design, create another one, and check out with all saved designs. The store must no longer force checkout immediately after a single design review.

## Approved experience

1. The generated-design review replaces its primary `Continue to checkout` CTA with `Add to cart · $X`.
2. Adding captures the exact reviewed configuration as an in-memory cart item: artwork version, prompt, chosen style/tone, color, size, placement transform, unit price, and quantity `1`.
3. A compact success state confirms that the item was added. Its two explicit next actions are:
   - `Checkout` — primary action.
   - `Create another design` — secondary action; starts a blank Step 1 immediately while preserving the cart.
4. The creation header exposes a cart button with a live item-count badge. Opening it shows saved items, their thumbnails/configuration, their subtotal, and `Checkout`.
5. Checkout receives the entire cart: compact summary, line-item quantity, shipping, and total are calculated from all saved items. The existing local-only checkout and thank-you behavior remains local; no payment, order creation, cart persistence, tax, or inventory reservation is added.

## Interaction details

- The cart is intentionally session-only. Reloading starts a new cart.
- Each press of `Add to cart` adds one line item. This preserves the normal store behavior of allowing two separately configured designs, including two copies of the same design if intentionally added twice.
- `Create another design` clears all current creative and product choices, returns to Step 1, and leaves cart state untouched.
- Cart access is available throughout Steps 1–3 and design review; checkout keeps its existing focused header treatment.
- The existing `Edit design`, regenerate, and back actions remain available before the item is added.

## Visual direction

- Use the selected CTA direction: specific, destination-led language for creation steps.
- The add CTA makes the price visible: `Add to cart · $31.98`.
- Cart feedback is affirmative but unobtrusive: a small success panel rather than a blocking modal.
- `Checkout` is the only filled primary action in that success panel; `Create another design` uses a quieter secondary treatment.

## Boundaries and verification

- Do not begin real payments, fulfillment calls, orders, account storage, discount codes, or inventory logic.
- Ensure the item count, all line items, item subtotal, shipping selection, and order total are consistent from cart through thank-you.
- Keep keyboard focus and `aria-live` feedback usable when an item is added and when the cart opens.
- Verify mobile layout, typecheck, lint, production build, and diff integrity.
