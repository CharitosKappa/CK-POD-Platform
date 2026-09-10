# Staff admin authentication — implementation plan

## Slice boundary

Implement invite-only passwordless staff authentication before migrating the existing Operations pages. The first working outcome is a protected `/admin` workspace, a dedicated staff sign-in flow, and one bootstrap owner. It does not activate an external email provider or change consumer authentication.

## 1. Dedicated staff identity storage

- Add migration tables for memberships, email challenges, sessions and immutable staff audit events.
- Add the server-only `INITIAL_ADMIN_EMAIL` and a distinct staff-code pepper to config validation and environment examples.
- Build a `StaffIdentityService` with generic non-enumerating code requests, bounded verification attempts, 12-hour sessions, owner bootstrap, and session revocation.

## 2. Admin authentication routes and pages

- Add `/admin/sign-in` and an OTP form derived from the approved passwordless interaction pattern, but with staff-specific copy and APIs.
- Add `/api/admin/auth/request-code`, `/verify-code`, `/session` and `/logout`.
- Add `requireAdminSession()` and a protected `/admin` layout that redirects browser routes to the staff sign-in page while APIs return safe `401`/`403` responses.

## 3. First protected admin area

- Add `/admin/customers` and `/admin/customers/:customerId` wrappers around the approved customer workspace.
- Authorize their read/mutation APIs with staff roles rather than consumer roles.
- Redirect `/ops/customers` to `/admin/customers`; preserve the consumer `/sign-in` and `/account` behavior unchanged.

## 4. Staff administration and broader workspace migration

- Add the owner-only staff directory, invitation, role, suspension and session-revocation APIs/pages.
- Move Orders, Providers and Review Queue from `/ops` and `/api/ops` to the staff-authorized `/admin` boundary in a follow-up slice.

## 5. Verification

- Add unit/integration tests for generic request responses, bootstrap, invite-only verification, independent cookie/session scope, role denial and revocation.
- Run migration, type checks, lint, targeted tests and a production build.
