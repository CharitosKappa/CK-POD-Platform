# Milestone 0 — Foundation Architecture

## Scope

Milestone 0 establishes the delivery and operational foundation for the Project Let It Be modular monolith. It deliberately does **not** implement identity, sessions, product catalogue, projects, assets, AI, editor, commerce, payments, orders, fulfillment, moderation, or admin workflows. Those boundaries are reserved for their named later milestones.

## Repository map before implementation

| Required Foundation capability       | Initial repository state      | Milestone 0 result                                                     |
| ------------------------------------ | ----------------------------- | ---------------------------------------------------------------------- |
| Application repository and workspace | Documentation-only repository | pnpm workspace with `apps/` and `packages/`                            |
| Base Next.js app                     | Absent                        | `apps/web`, including a health endpoint                                |
| Background runtime                   | Absent                        | `apps/worker` executable without domain consumers                      |
| Domain boundaries                    | Absent                        | Vendor-neutral domain ownership map in `packages/domain`               |
| PostgreSQL and migrations            | Absent                        | PostgreSQL Compose service, Drizzle boundary, and a baseline migration |
| Object storage                       | Absent                        | Private storage interface plus S3-compatible and memory adapters       |
| Queue                                | Absent                        | Queue interface plus BullMQ and memory adapters                        |
| Observability                        | Absent                        | Redacting JSON logger and OpenTelemetry API instrumentation helper     |
| Quality controls                     | Absent                        | TypeScript, ESLint, Prettier, Vitest, and GitHub Actions CI            |
| Environment configuration            | Absent                        | Validated server configuration and safe `.env.example`                 |
| ADR process                          | Absent                        | Numbered ADR structure in `docs/decisions`                             |

## Deployment shape

```text
Browser
  │
  ▼
Next.js web application ──────► PostgreSQL
  │                                  ▲
  │                                  │ migrations
  ▼                                  │
Private object-storage interface      │
  │                                  │
  └─ S3-compatible adapter            │

Next.js / domain modules ──► queue interface ──► Redis-backed worker
                              │
                              └─ in-memory adapter for local tests
```

The diagram describes infrastructure boundaries, not yet-implemented product flows. Both the web process and worker remain parts of one modular-monolith codebase and one deployable product topology.

## Decision classification

| Item                                                                                             | Classification          | Resolution                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Workspace layout, package manager, ORM, queue adapter, storage adapter, observability, tests, CI | `IMPLEMENTATION DETAIL` | Chosen in ADRs 0001–0008 using the smallest maintainable setup compatible with the specification and MVP budget. |
| G1 AI benchmark                                                                                  | `EXECUTION GATE`        | Blocks final AI routing only; does not block Foundation.                                                         |
| G2 AI economics                                                                                  | `EXECUTION GATE`        | Blocks final credit/pricing decisions only; does not block Foundation.                                           |
| G3 provider qualification                                                                        | `EXECUTION GATE`        | Blocks production launch only; does not block Foundation.                                                        |
| G4 US tax configuration                                                                          | `EXECUTION GATE`        | Blocks commercial launch only; does not block Foundation.                                                        |
| G5 legal/privacy review                                                                          | `EXECUTION GATE`        | Blocks public launch only; does not block Foundation.                                                            |
| G6 physical test prints                                                                          | `EXECUTION GATE`        | Blocks production automation only; does not block Foundation.                                                    |

There are no `PRODUCT DECISION REQUIRED` items preventing Milestone 0.

## Foundation verification

1. Copy `.env.example` to `.env`.
2. Run `pnpm install`.
3. Run `pnpm db:up` and wait for the containers to become healthy.
4. Run `pnpm db:migrate` then `pnpm db:verify`.
5. Run `pnpm dev` and open `http://localhost:3000` or call `http://localhost:3000/api/health`.
6. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

The GitHub Actions workflow performs the equivalent quality checks and performs the migration/verification check against a dedicated PostgreSQL service.
