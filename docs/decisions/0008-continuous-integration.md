# ADR 0008: Use GitHub Actions quality and migration jobs

- Status: Accepted
- Date: 2026-08-29

## Context

Milestone 0 requires repeatable CI for format, lint, types, tests, build, and migrations.

## Decision

Run two GitHub Actions jobs on pull requests and pushes to `main`: a quality job for formatting, linting, type checks, tests, and build; and a PostgreSQL-backed job that applies and verifies migrations.

## Consequences

Changes fail early if they break baseline checks or migrations. Production deployment, secret provisioning, backup execution, and restore drills are intentionally outside the Foundation and will require additional CI/CD decisions.
