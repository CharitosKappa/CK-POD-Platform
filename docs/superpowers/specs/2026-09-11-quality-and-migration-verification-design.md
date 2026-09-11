# Quality and migration verification correction

## Purpose

Restore a green repository quality gate and make local schema verification accurately
detect whether the database has reached the checked-in migration state.

## Scope

- Run Prettier only against the files reported by the existing format check.
- Apply the existing checked-in Drizzle migrations to the configured local development
  database. No migration SQL is edited and no database is recreated.
- Extend database verification to require the tables introduced by migrations 0029 through
  0035, including fulfillment-group, customer-profile, customer-contact, and staff-admin
  tables.
- Re-run formatting, migration verification, integration tests, lint, typecheck, tests,
  and production builds.

## Safety boundary

Migration application is additive and uses the existing Drizzle migration runner. If it
cannot safely bring the configured database forward, work stops before any database reset,
drop, or recreation. No production database is in scope.

## Acceptance criteria

- `pnpm format:check` passes.
- The local database has the current tables required by the application.
- `pnpm db:verify` fails when any current required table is absent and passes after a
  correct migration.
- `pnpm test:integration` passes against the migrated local database.
- Lint, typecheck, default tests, and both application builds pass.
