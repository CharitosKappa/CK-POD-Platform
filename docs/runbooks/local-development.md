# Local development

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
