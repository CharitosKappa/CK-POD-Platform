# ADR 0001: Use a pnpm workspace monorepo

- Status: Accepted
- Date: 2026-08-29

## Context

The web runtime, worker runtime, and shared domain/infrastructure code must evolve together as one modular monolith. The project begins empty and the MVP budget favors a small, well-supported toolchain.

## Decision

Use pnpm workspaces with `apps/*` for runnable processes and `packages/*` for shared code. Use Node 22 and pin the package-manager version in `package.json`.

## Consequences

Workspace packages use explicit `workspace:*` dependencies, reducing duplicate types and keeping boundaries reviewable. This is a monorepo, not a set of microservices; deployment separation is added only where an asynchronous worker requires it.
