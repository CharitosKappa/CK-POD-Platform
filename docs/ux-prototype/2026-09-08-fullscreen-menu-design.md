# UX prototype — Full-screen editorial menu

## Goal

Replace the current side drawer with the approved full-screen mobile navigation overlay (Direction A: Editorial list).

## Experience

- The menu occupies the full viewport, including the safe-area bounds, over the current creation step.
- A compact top row contains the `LET IT BE` wordmark and a clear close control.
- The primary navigation is a large, vertically stacked editorial list in this order: `Make a shirt`, `My designs`, `My cart`, `How it works`, `Help & support`.
- `Make a shirt` is visually first and returns the shopper to a clean Step 1. `My cart` shows the live cart-item count when non-zero and opens the existing cart drawer.
- A quiet bottom section includes `Sign in` and supporting links: Shipping, Returns, FAQ, Contact.
- The design uses the existing warm background, black typography, subtle dividers, and the existing red action color only for focus/interactive states. It does not use the red full-screen treatment from Direction C.

## Accessibility and behavior

- Keep dialog semantics, focus on the close control when opened, Escape to close, overlay click to close, and return focus to the menu trigger.
- Prevent background scrolling while open.
- Do not implement authentication, account pages, help pages, or new routing in this change; inactive items remain visually present for the prototype.

## Verification

- Test open/close, Escape, cart entry, and Create entry on mobile.
- Verify formatting, TypeScript, lint, production build, and diff integrity.
