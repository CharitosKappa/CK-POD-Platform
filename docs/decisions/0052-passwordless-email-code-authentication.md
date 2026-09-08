# ADR 0052: Use passwordless email one-time codes for consumer authentication

- Status: Accepted
- Date: 2026-09-08

## Context

The approved consumer UX uses a six-digit code delivered to email and does not expose passwords. The prior Milestone 1 development implementation used local password hashes solely as a simple authentication mechanism.

The platform must preserve guest-first creation, account persistence, and guest-to-account migration without requiring registration before the first free generation.

## Decision

Use a short-lived, single-use, database-backed email one-time-code challenge. Verify the code before creating a previously unknown user. Upgrade the current guest session through the existing atomic ownership-migration path, issuing a new opaque authenticated session.

Define an internal email-code delivery interface. Use a local structured-log adapter in development and a deterministic in-memory fake in tests. A real transactional provider is deferred and must be selected through configuration rather than embedded in identity logic.

## Consequences

- Consumer accounts are passwordless.
- Account existence is not disclosed during code requests.
- The database stores only code hashes, never raw codes.
- Existing local password hashes may remain for migration compatibility but are not a consumer authentication mechanism.
- Email delivery remains an external dependency that can be swapped without changing the account/session domain.
