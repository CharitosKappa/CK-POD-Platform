# Account area — production data design

## Scope

Connect the existing mobile account experience to the production backend. Preserve the approved passwordless sign-in flow and the visual language already used by the UX prototype. Do not add a payment provider, external email delivery provider, or AI generation provider in this slice.

## Routes

- `/account` is the signed-in account hub: email, available design credits, recent saved designs, and recent orders.
- `/account/personal` lets the customer edit their first and last name and manage saved shipping addresses.
- `/account/designs` lists saved designs belonging to the authenticated user and links each item to its view/edit continuation.
- `/account/credits` shows the current AI design-credit balance and a chronological credit ledger with date and time.
- `/account/orders` lists the customer's orders and links to their existing order details.

Unauthenticated visitors are sent to `/sign-in` with the requested account path as `returnTo`.

## Data and ownership

All reads and writes are owner-scoped through the authenticated user ID. Guest-owned projects, carts, and orders continue to be attached to that user by the existing identity promotion logic after passwordless sign-in.

The account API returns explicit view models rather than exposing database rows. It provides only public asset-preview URLs and never storage keys, production-master assets, provider credentials, payment secrets, or internal moderation data.

Personal data is stored separately from checkout snapshots. A successful checkout may optionally save the submitted delivery address to the user's address book; changing an address later never modifies an existing order's immutable shipping snapshot.

## UI and interactions

The production pages reuse the existing account page composition from the prototype: the quiet editorial header, mobile-width content column, cards, and list rows. Loading, empty, success, and validation states use the store's shared inline-feedback system.

Personal details save with revision-safe requests. Address creation, editing, default-address selection, and deletion are explicit actions. The hub uses small recent-item summaries; the four detail routes provide the complete lists or editors.

Saved designs remain immutable snapshots at the cart/order boundary. Opening a saved design creates or resumes a design workflow; it does not alter an order item.

## API surface

- `GET/PATCH /api/account/profile`
- `GET/POST/PATCH/DELETE /api/account/addresses`
- `GET /api/account/designs`
- `GET /api/account/credits`
- `GET /api/account/orders`

The route naming keeps account reads separate from existing operational/admin APIs. Existing `/api/credits` and order routes remain available for the create and checkout flow while the account routes supply account-specific views.

## Validation and failure behavior

- Names, US addresses, and default-address selection are validated server-side.
- A stale profile/address revision returns a clear retry message without overwriting newer data.
- Empty accounts show useful empty states rather than fabricated orders, designs, addresses, or credit activity.
- A missing or unauthorized resource returns a non-enumerating not-found response.

## Verification

- Domain tests cover ownership isolation, profile/address validation, and chronological credit/order/design views.
- Route tests cover authentication redirects and error mapping.
- Type checks run for domain, web, and UX prototype.
- Manual mobile pass: sign in, edit personal data, add/edit/remove an address, review credits, inspect a saved design, inspect an order, and return to the account hub.
