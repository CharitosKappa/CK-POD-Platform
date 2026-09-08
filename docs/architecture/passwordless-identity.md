# Passwordless Identity Architecture

## Goal

Replace the development email-and-password account flow with the approved passwordless email one-time-code flow. Preserve the existing guest-first session model and the atomic migration of guest projects, carts, orders, and generation credits into an authenticated account.

This is an implementation update to Milestone 1. It does not connect the UX prototype to production APIs yet, introduce a real email vendor, or change commerce, fulfillment, or generation behavior.

## Consumer flow

1. A visitor continues to receive an opaque guest session on the first stateful request.
2. The visitor enters an email address and requests a six-digit sign-in code.
3. The app always confirms that a code was requested without revealing whether the address already has an account.
4. The visitor submits the code. A valid code either signs in to the existing account or creates the account at that point.
5. The existing guest session is upgraded into a fresh authenticated session and its eligible guest-owned data is migrated atomically.

An account is therefore created only after successful code verification, never merely because an address was typed. Future checkout and newsletter flows can create or attach an account through the same verified identity boundary.

## API contract

### `POST /api/auth/request-code`

Accepts `{ email }`. Validates the email, applies IP and email-based throttles, creates a one-time challenge, and invokes the configured code-delivery adapter. The success response is intentionally generic.

### `POST /api/auth/verify-code`

Accepts `{ email, code }`. It atomically consumes a valid, unexpired challenge; finds or creates the user; migrates the current guest ownership; and sets a new opaque authenticated-session cookie.

### `GET /api/auth/session`

Returns the current session kind and, when authenticated, a minimal account identity for clients that need to decide whether to show account actions.

`POST /api/auth/logout` remains unchanged. Existing password registration and login endpoints are retired from the consumer contract; they must not remain an alternate sign-in method.

## Persistence and security

- Add a migration that makes `app.users.password_hash` nullable and records `email_verified_at`.
- Add `app.email_login_challenges` with a normalized-email hash, a cryptographic code hash, expiry, attempt counter, consumed timestamp, and delivery metadata. Raw codes are never stored.
- Generate a cryptographically random six-digit code. Challenge validity is ten minutes; a code is single use; attempts are limited; a resend invalidates any prior active code for that address.
- Use the existing database-backed opaque session cookie and the existing account-migration transaction. No raw session token or code is persisted.
- Apply rate limits to code requests and verification attempts. Responses must not enumerate accounts.
- A successful verification is the point at which an email becomes verified.

## Local development delivery

Introduce an internal `EmailCodeDelivery` interface. The default development adapter writes a clearly structured code-delivery event to the local server log, with no external network call and no provider credentials.

The code is never returned in the production-shaped API response. Tests use a deterministic fake adapter that captures deliveries in memory. A later transactional-email provider implements the same interface and is enabled solely by configuration.

## Compatibility and migration

Existing development users remain valid. Their password hashes are retained but no longer used by the consumer sign-in flow; the migration marks their established email as verified. New users have no password hash.

## Verification

- Unit-test code generation, hashing, expiry, consumption, retry limits, and non-enumerating responses.
- Integration-test guest-to-new-account and guest-to-existing-account migration for projects, carts, orders, and credits.
- Verify invalid, expired, reused, and rate-limited codes do not create sessions or migrate data.
- Verify the local adapter performs no network call and production configuration cannot accidentally use it.
- Run migrations, typecheck, lint, unit tests, and identity integration tests.

## Explicitly out of scope

- A real email provider, domain verification, deliverability monitoring, email templates, password reset, OAuth, MFA, SMS, or a production UI migration.
