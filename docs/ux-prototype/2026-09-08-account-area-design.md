# Account Area — UX Prototype Design

## Objective

Extend passwordless account access into a mobile-first account area. The signed-in menu exposes a linkable `My account` entry. The account overview gives the customer a concise view of personal delivery information, saved designs, design-generation credits, and orders, with dedicated full-screen views for every editable or viewable area.

## Scope and boundary

This remains browser-local UX prototype state. It does not send email, persist customer records, create orders, charge payments, synchronize addresses, or authenticate against a backend. The UI treats a successful six-digit passwordless-code entry as signed in and retains the current cart and in-progress design.

The existing sign-in view is inset from the viewport with a quiet card frame and a small outer margin. It is no longer edge-to-edge while retaining the existing full-screen background and mobile safe areas.

## Account overview

`My account` opens a full-screen view with back navigation to the menu and this fixed mobile order:

1. **Personal & addresses** — full name, email, and default delivery address.
2. **Saved designs** — a compact preview of saved design cards.
3. **Design credits** — available generation credits and recent activity.
4. **Orders** — the most recent order and its current fulfillment status.

The overview uses only a compact preview for each collection. Every interactive label is a real control leading to the corresponding account view.

## Subpages

All subpages are local full-screen account views. Back returns to the account overview, preserving its browser-local state and scroll-independent content. They are structured as independent views so production implementation can later map them to URLs.

### Personal details

`Edit personal details` exposes full name and email. Saving updates the displayed account name and email in the overview and menu locally.

### Addresses

`Manage addresses` lists addresses, supports add/edit, and allows exactly one default delivery address. Checkout addresses are treated as saved automatically only when a new address is used. A saved address is never overwritten by a checkout entry; explicit edit remains required. The prototype initializes one Florida address.

### Saved designs

`View all` opens the saved-design library. A design detail view shows its preview, style/tone metadata, and actions to use it again or remove it. In the prototype, use-again restores that design's creative setup locally; removal updates the library and overview preview.

### Design credits

`View history` opens an immutable activity list. Entries communicate either credit additions or credits spent on generation/regeneration, with a timestamp and signed quantity. `Get more` opens the existing local credit-purchase sheet. The label is always `Design credits`, not `AI credits`.

### Orders

`View all` opens the order list. Selecting an order opens a detail view with items, quantity, shipping address, total, and fulfillment status. This is display-only in the UX prototype; order data is seeded locally.

## Navigation and signed-in state

- The menu shows `Sign in` for a signed-out shopper.
- After passwordless verification, it shows a linkable `My account`, the signed-in email, and `Sign out`.
- `My account` opens the overview; `Sign out` clears only the browser-local signed-in state.
- Account subpages use a back arrow and accessible dialog/page semantics. Escape returns to the immediate parent view.

## Verification

1. Sign in opens inside the inset frame without triggering iOS focus zoom.
2. The signed-in menu opens `My account`; sign-out returns it to `Sign in`.
3. The overview displays the approved section order.
4. Personal detail and address edits update account overview state; only one address is default.
5. Saved designs can be viewed, used, and removed; the overview follows the local library.
6. Credit history shows additions and generation usage; purchasing credits updates the balance and records an activity entry.
7. Order list and detail open and return correctly, while cart/design state remains unchanged.
8. Run format, lint, typecheck, and mobile-browser smoke tests after implementation.
