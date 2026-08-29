# ADR 0003: Use PostgreSQL with Drizzle ORM and checked-in SQL migrations

- Status: Accepted
- Date: 2026-08-29

## Context

The specification requires PostgreSQL, migrations, safe data access, and a database that will later support a broad transactional and audit data model.

## Decision

Use PostgreSQL 16 for local development and CI. Use Drizzle ORM's node-postgres driver as the typed database boundary and its migration runner with reviewed SQL files committed in `packages/db/drizzle`.

## Consequences

Migrations are deterministic, inspectable, and runnable in CI. The Foundation migration creates only the application schema; product tables remain deferred to their owning milestones. Future queries must use the typed boundary or parameterized SQL.
