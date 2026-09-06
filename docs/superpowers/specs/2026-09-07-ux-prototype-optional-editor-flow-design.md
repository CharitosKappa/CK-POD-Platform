# UX prototype optional editor flow

## Objective

Make artwork placement editing optional. A customer who accepts the generated design must be able to continue directly toward checkout without entering the editor.

## Approved flow

The mobile flow is:

1. Generate design.
2. Review the generated shirt.
3. Continue directly to checkout, or optionally open `Edit design`.
4. When editing is complete, `Save & continue` proceeds toward checkout.

The editor is not presented as another numbered or required step.

## Generated-design review

The generated-design review becomes the decision point:

- `Continue to checkout` is the primary CTA.
- `Edit design` is a secondary action.
- `Try another version` and `Back to color & size` retain their current behavior.
- Entering the editor preserves the current garment, artwork version, product color, size, price, prompt, style, tone, and remaining credits.

Because checkout is outside the current isolated prototype boundary, `Continue to checkout` displays a local-only acknowledgement that checkout is next. It must not call an API, create a cart, charge a payment method, or imply that a purchase was completed.

## Optional editor

The editor retains its existing placement controls and safe-area constraints. `Save & continue` stores the placement in browser-local React state and returns the customer to the same generated-design review, where checkout remains the primary next action.

`Back to preview` returns without discarding the current placement state. Reopening the editor restores the last locally saved or adjusted placement for the current design.

## State and boundaries

- Generation remains simulated and local.
- Editor history and placement remain local.
- No backend, provider, cart, checkout, or payment connectivity is added.
- Regenerating the artwork resets its editor placement to the default and preserves the existing credit behavior.
- Returning to Color & Size keeps the existing generated-preview reuse behavior unless the creative inputs change.

## Verification

Verify the following paths in a browser:

1. Generate → `Continue to checkout` without opening the editor.
2. Generate → `Edit design` → adjust placement → `Save & continue` → generated-design review.
3. Reopen `Edit design` and confirm the local placement is preserved.
4. `Back to preview` returns to review without blocking checkout.
5. `Try another version`, `Back to color & size`, safe-area enforcement, credit behavior, product selections, and pricing continue to work.

Run format, lint, typecheck, and production build after implementation.
