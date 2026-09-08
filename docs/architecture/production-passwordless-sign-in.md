# Production Passwordless Sign-In Slice

## Goal

Connect the production store in `apps/web` to the existing passwordless identity API. This slice replaces the retired email-and-password form without moving the full UX prototype or changing checkout, fulfillment, email delivery, or account-management features.

## Scope

- Add a dedicated `/sign-in` page in the production store.
- Use a two-stage mobile flow: email address, then six-digit one-time code.
- Replace the old password form on `/describe` with a clear link to `/sign-in`.
- Read the current identity through `GET /api/auth/session` so the creation page can show a signed-in state and a logout action.
- Verify a code through `POST /api/auth/verify-code`; successful verification preserves the existing guest-to-account migration implemented by the domain layer.
- Use `autocomplete="one-time-code"` and inputs of at least 16px to support operating-system code suggestions and prevent iPhone input zoom.

## Local development behavior

`POST /api/auth/request-code` keeps its production-shaped generic success response. The development adapter writes the code only to the local web-server terminal. The browser receives neither the raw code nor a development inbox endpoint. This keeps the mobile test flow close to production while avoiding code exposure to devices on the local network.

## Client flow

1. The visitor opens `/sign-in` and submits a valid email address.
2. The client requests a code and presents the code-entry state without disclosing whether the address already has an account.
3. The visitor copies the local terminal code during development, or accepts an operating-system one-time-code suggestion when a real email provider is added later.
4. A successful verification refreshes the session state, shows the authenticated confirmation, and returns the visitor to their prior destination when one was supplied.
5. A failed or expired code remains on the sign-in page with the API error rendered through the shared form-status treatment. The visitor can request a new code.

## Boundaries

The sign-in client talks only to `/api/auth/request-code`, `/api/auth/verify-code`, `/api/auth/session`, and `/api/auth/logout`. It does not access database tables, delivery adapters, or guest-migration internals. The server remains responsible for session issuance, account creation, throttling, code validation, and ownership migration.

## Explicitly out of scope

- A transactional email provider or inbox UI.
- Checkout, order, newsletter, or saved-design account links.
- The full account page and account subpages.
- Migrating the entire `apps/ux-prototype` visual system into `apps/web`.
- Password login, password reset, OAuth, SMS verification, or MFA.

## Verification

- Requesting a code uses the existing generic API response and terminal-only local delivery.
- A valid code signs the visitor in and shows the authenticated state on `/describe`.
- Invalid, expired, and reused codes show an accessible error and do not authenticate the visitor.
- Mobile inputs do not cause iPhone zoom and the code field advertises one-time-code autocomplete.
- Run the web typecheck, lint, identity tests, and production web build.
