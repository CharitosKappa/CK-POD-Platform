# ADR 0002: Use Next.js with a separate worker executable

- Status: Accepted
- Date: 2026-08-29

## Context

The specification recommends Next.js, React, TypeScript, a modular domain-oriented backend, and asynchronous work. The MVP must avoid unnecessary microservices.

## Decision

Use one Next.js App Router application at `apps/web` and one TypeScript worker executable at `apps/worker`. Put product domain code in `packages/domain`, organised by named modules, while runtime-specific route and consumer code stays thin.

## Consequences

The web app and worker can scale independently when needed while sharing one repository, one database, and platform-owned contracts. No business domain behaviour is placed directly in a vendor adapter or a UI route.
