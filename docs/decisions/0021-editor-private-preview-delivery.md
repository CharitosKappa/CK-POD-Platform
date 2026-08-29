# ADR 0021: Serve editor artwork through an authorized preview-only route

- Status: Accepted
- Date: 2026-08-29

## Context

Guest and authenticated editors need visible artwork while source outputs must remain private.

## Decision

Resolve only active `PREVIEW` asset records after project ownership verification, then stream their bytes from private storage with private/no-store headers. Source asset IDs, keys, objects, and URLs are never returned.

## Consequences

Guests retain a secure editor flow and accounts retain the same authorization boundaries. Public sharing and production delivery can add distinct reduced-preview mechanisms later.
