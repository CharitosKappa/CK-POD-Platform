# ADR 0007: Use Vitest for unit contracts and Docker-backed integration verification

- Status: Accepted
- Date: 2026-08-29

## Context

The Foundation requires fast tests for infrastructure contracts and proof that PostgreSQL migrations run. Later milestones require unit, integration, and end-to-end coverage.

## Decision

Use Vitest for TypeScript unit tests, with in-memory storage and queue adapters as deterministic test doubles. Use Docker Compose locally and a PostgreSQL service container in CI to run and verify migrations.

## Consequences

Tests can run without vendor credentials. Later integrations add sandbox/contract tests behind adapters, and end-to-end journeys are introduced only as their corresponding product flows exist.
