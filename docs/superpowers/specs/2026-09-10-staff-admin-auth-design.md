# Staff admin authentication — invite-only passwordless access

## Purpose

Create a dedicated authentication boundary for the internal admin workspace. Staff access is invite-only and passwordless. It is independent from consumer accounts, consumer sessions, and the public store sign-in experience.

## Experience

### Entry and return routing

- Staff start at `/admin/sign-in`.
- Entering an invited email sends a six-digit sign-in code through the configured staff email delivery adapter.
- Verifying the code creates an admin-only session and redirects to the originally requested internal URL, defaulting to `/admin`.
- `/ops/*` becomes a compatibility redirect to the corresponding `/admin/*` route once the admin workspace is protected. It must not expose an internal page before staff authentication succeeds.
- The existing `/sign-in` route and customer session remain exclusively consumer-facing.

### First owner

`INITIAL_ADMIN_EMAIL` is a server-only bootstrap setting. On first authorized staff sign-in, it provisions one active `OWNER` staff membership for that normalized email. It is not sent to the browser, returned by APIs, or used as a public registration route.

If the setting is absent, no new staff member can self-provision. Existing active staff memberships remain able to sign in.

### Staff lifecycle

An `OWNER` can invite an email into one of the allowed roles. An invited person becomes active only after completing their first code verification. Owners can view staff, change permitted roles, suspend access, and revoke active sessions.

Suspension immediately invalidates new access. Revoking a staff member terminates all their current admin sessions. The final active owner cannot be suspended, revoked, or demoted, preventing accidental lockout.

## Roles and authorization

The staff system has separate roles from `app.users.role`:

- `OWNER` — bootstrap, invite/revoke/suspend staff, manage all admin operations.
- `OPERATIONS` — orders, fulfillment, customer support, customer data, notes and tags.
- `PREPRESS` — prepress/review work only.
- `READ_ONLY` — safe operational reads, with no data mutation.

Route and domain authorization use staff role capabilities rather than the consumer `users.role` column. This prevents a customer account’s role from accidentally granting admin access. Existing development operations roles are migrated or explicitly mapped to staff memberships only through a trusted provisioning command; no automatic consumer-role elevation occurs.

## Data and security boundary

Add dedicated data structures:

- `staff_members` — normalized email, role, active/suspended status, invited/activated timestamps, and audit ownership;
- `staff_email_challenges` — one-time code hash, expiry, attempt count and consumption record;
- `staff_sessions` — independent token hash, membership link, session expiry, last-seen timestamp and revocation timestamp; and
- `staff_audit_events` — trusted audit log for invitations, role changes, suspension, revocation and owner bootstrap.

The browser receives only an opaque, HTTP-only `let_it_be_admin_session` cookie with `SameSite=Lax`, secure-in-production attributes and a 12-hour absolute lifetime. No raw codes, code hashes, tokens, email provider credentials, or user/payment data are returned to the browser.

Staff email codes have the same 10-minute maximum lifetime and bounded attempt policy as consumer codes, but use a distinct pepper, rate-limit namespaces, database table, cookie name, and code-delivery event. Code requests disclose no membership state: the UI gives the same generic confirmation for both invited and uninvited emails.

## Routes and API surface

- `GET /admin/sign-in` renders the dedicated staff sign-in page.
- `POST /api/admin/auth/request-code` accepts a normalized email and always returns a generic success response when rate limiting permits.
- `POST /api/admin/auth/verify-code` verifies an active invitation or the bootstrap owner email, creates the admin session and sets the admin cookie.
- `POST /api/admin/auth/logout` revokes the current admin session and clears only the admin cookie.
- `GET /api/admin/auth/session` returns the safe current staff identity and role.
- `/api/admin/staff/*` is owner-only and supports staff directory, invitation, role updates, suspension and revocation.

`requireAdminSession()` is the sole server-side session entry point for `/admin` pages and `/api/admin/*` routes. `requireSession()` continues to serve consumer routes only.

## Workspace migration

The operations workspace moves from `/ops` to `/admin` while retaining the approved fixed sidebar and full-main-window navigation. The existing Customers, Orders, Providers and Review Queue pages are moved or wrapped under `/admin`. Their read/mutation calls migrate from `/api/ops/*` to `/api/admin/*` and receive role-specific authorization.

The user-visible admin workspace remains desktop-strong and responsive on mobile. The first version does not add a public staff signup, SMS/TOTP, SSO, email provider integration, user-password management, or consumer-account management from the staff page.

## Failure handling

- An unauthenticated admin request redirects browser pages to `/admin/sign-in?returnTo=…` and returns `401` from APIs.
- A valid staff session without capability returns `403` with a safe message.
- Expired, consumed or invalid codes use one generic code error.
- A suspended/revoked staff membership clears the stale cookie and returns the user to staff sign-in.
- Invitation, role and state mutations are idempotent where possible, explicit about errors, and audit logged.

## Validation

- Domain integration tests cover bootstrap-owner conditions, non-enumerating requests, code expiry/attempt limits, session isolation, role capabilities, owner lockout prevention, suspension and revocation.
- Route tests cover redirects, cookies, safe API errors, rate-limit namespaces and invite lifecycle validation.
- UI tests cover the staff OTP flow, return routing and unavailable/suspended feedback.
- Run database migrations against the local test database, domain/web type checks, lint, targeted auth tests and a production web build.
