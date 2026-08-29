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

## Local services

```powershell
pnpm db:up
pnpm db:down
```

`pnpm db:down` stops containers while retaining Docker volumes. To remove a local volume, use Docker Desktop intentionally; no project command removes it automatically.
