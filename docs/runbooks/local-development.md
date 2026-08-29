# Local development

## Fulfillment / Printify development

Fulfillment defaults to `FULFILLMENT_ADAPTER=fake`. The deterministic fake adapter supports catalog sync, variant availability, shipping estimates, provider state differences, and routing tests without API credentials. It deliberately rejects production submission.

To use the real adapter, set all of the following in a local, uncommitted `.env` file:

```text
FULFILLMENT_ADAPTER=printify
PRINTIFY_API_TOKEN=...
PRINTIFY_SHOP_ID=...
PRINTIFY_API_BASE_URL=https://api.printify.com/v1
PRINTIFY_WEBHOOK_SECRET=...
```

Credentials are server-only. Do not use real mode in CI and do not place credentials in browser variables. The trusted `/ops/providers` page requires an operationally assigned `FULFILLMENT_ADMIN` user role; it is not a consumer surface. Refreshing catalog data preserves qualification and provider-status controls. G3/G6 evidence must be recorded before any candidate can be qualified.

Run `pnpm fulfillment:reconcile` to perform the same bounded, idempotent catalog reconciliation used by the trusted refresh control. It only synchronizes platform-allowlisted mappings.

## Prerequisites

- Node 22.19.0 (see `.nvmrc`)
- pnpm 10.33.0 or newer
- Docker Desktop with Compose

## First run

```powershell
Copy-Item .env.example .env
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:verify
pnpm dev
```

Open `http://localhost:3000`. The health endpoint is `http://localhost:3000/api/health`.

The default `memory` adapters let the application and unit tests run without cloud credentials. To exercise PostgreSQL migration checks, the local Compose service must be running. Do not place production secrets in `.env`; it is ignored by Git.

PostgreSQL is exposed on host port `15432` by default to avoid colliding with an existing local PostgreSQL instance. Set `POSTGRES_PORT` before `pnpm db:up` and update `DATABASE_URL` together if another host port is required.

## Quality checks

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Milestone 1 persistence checks

With the local database running, apply and verify all checked-in migrations, then run the integration suite:

```powershell
pnpm db:migrate
pnpm db:verify
pnpm test:integration
```

Open `http://localhost:3000` to exercise the development-only **Choose Product → Choose Color** flow. It creates a guest project, and the following placeholder page offers account creation to transfer that guest project's state and history. Milestone 2 supplies the authorized generation API and worker foundation; its editor surface remains out of scope until Milestone 3.

## Milestone 3 editor checks

Open the **Make It Yours** link for a saved project, or visit
`http://localhost:3000/editor?project=<project-id>`. The editor saves only its canonical
`EditorDocumentV1` after a configurable debounce (`NEXT_PUBLIC_EDITOR_AUTOSAVE_DEBOUNCE_MS`,
default 700ms) and retains configurable local undo history (`NEXT_PUBLIC_EDITOR_UNDO_LIMIT`,
default 50). A stale save deliberately leaves the browser draft intact; reload the project before
retrying.

The development print-area and quality indicator are not production prepress. The app allows an
invalid temporary draft to save, but disables the Continue action until it is placed inside the
visible safe boundary. Controlled preview URLs are authorized per guest session or account and
must never be replaced with source-object URLs.

## Milestone 4 prepress checks

Use the editor’s **Check print quality** action after a save. It creates an asynchronous server
prepress run for the active immutable project version. The memory queue completes it in the web
process for local development; use `pnpm dev:worker` with Redis for a separate worker. The result
contains only a controlled summary and reduced preview; production-master and source keys must not
be returned by browser APIs.

The seeded profile is intentionally `UNQUALIFIED / DEVELOPMENT`. Its 12 × 16 inch / 3600 × 4800
pixel DTG values and DPI thresholds are useful for development tests only. Do not use it to submit
production work or declare G3 complete. Run `pnpm test:integration` with PostgreSQL available to
verify lifecycle, retry, lineage, and production-master access controls.

## Milestone 2 generation checks

Use Redis locally for a separate generation worker (`QUEUE_DRIVER=redis` in `.env.example`), then start it in a second terminal:

```powershell
pnpm dev:worker
```

The default provider configuration contains two deterministic, zero-cost adapters. It does not call a paid AI API. Run the persisted lifecycle tests with `pnpm test:integration`, then run the development benchmark fixture with:

```powershell
pnpm benchmark:g1
```

The command emits controlled JSON. Set `G1_BENCHMARK_DATASET` to a versioned full dataset and `G1_MANUAL_SCORES_FILE` to a JSON score import before executing the real G1 comparison. Do not use its output to select a production provider until the G1 review is complete.

## Local services

```powershell
pnpm db:up
pnpm db:down
```

`pnpm db:down` stops containers while retaining Docker volumes. To remove a local volume, use Docker Desktop intentionally; no project command removes it automatically.
