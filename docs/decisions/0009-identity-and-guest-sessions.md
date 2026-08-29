# ADR 0009: Use database-backed opaque sessions and local accounts

- Status: Accepted
- Date: 2026-08-29

## Context

Milestone 1 requires secure guest-first ownership, optional accounts, and transfer of every guest project to an account without adopting enterprise identity infrastructure.

## Decision

Store opaque, 256-bit session tokens only as SHA-256 hashes in PostgreSQL. Send the raw token in an HttpOnly, Secure-in-production, SameSite=Lax cookie. Store local account emails with salted scrypt password hashes. Registration and login upgrade the current session and migrate that session's guest projects in one transaction.

## Consequences

Guest users create projects without registration. Account sessions can access user-owned projects across sessions; guests can access only projects bound to their exact session. Password reset, email verification, OAuth, MFA, and external identity providers remain out of scope.
