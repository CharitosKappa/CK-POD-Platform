# Project Let It Be

AI-powered custom apparel platform that enables consumers to create unique T-shirt designs using text and image prompts, refine them through a constrained merchandise editor, preview the result, purchase the product, and have the order routed to Printify for production and fulfillment.

## Project Status

The project is currently in the **MVP implementation phase**.

Development must proceed milestone-by-milestone according to the authoritative specification below.

## Authoritative Specification

The primary product, technical, and execution specification is:

`/docs/MASTER_BUILD_PROMPT.md`

This document is the source of truth for:

- product vision
- MVP scope
- system architecture
- AI orchestration
- editor requirements
- prepress and printability logic
- Printify integration
- fulfillment routing
- commerce and checkout
- moderation and IP rules
- admin and CX workflows
- analytics
- security
- testing
- implementation milestones
- execution gates
- acceptance criteria

If there is any conflict between implementation assumptions and the master specification, follow the conflict-resolution priority defined inside `MASTER_BUILD_PROMPT.md`.

## Supporting Requirements

Historical CEO requirements and the original completed questionnaire are available at:

`/docs/CEO_REQUIREMENTS_GR.md`

This file provides context and decision history, but it is **not authoritative over later locked decisions** contained in `MASTER_BUILD_PROMPT.md`.

## MVP Summary

Initial MVP scope:

- Market: USA
- Primary persona: Consumer
- Product: DTG T-shirts
- Platforms: Desktop + Mobile
- AI: Multi-model, provider-agnostic orchestration
- Editor: Constrained, layer-aware merchandise editor
- Checkout: Custom Stripe-based checkout
- Fulfillment: Printify
- Production flow: Manual review first, automation later
- Target availability: 99.9%
- Target launch: Q4 2026

## Core User Journey

`Choose Product → Describe Idea → Generate → Edit → Preview → Approve → Checkout → Production → Delivery`

## Development Model

Codex must implement the project sequentially.

Do **not** attempt to build the entire project in a single pass.

Development starts with:

**Milestone 0 — Foundation**

After each milestone:

1. run tests,
2. update documentation,
3. summarize completed work,
4. list remaining items,
5. identify blockers or execution gates,
6. stop before the next milestone unless explicitly instructed to continue.

## Repository Structure

Expected high-level structure:

```text
/
├── README.md
├── docs/
│   ├── MASTER_BUILD_PROMPT.md
│   └── CEO_REQUIREMENTS_GR.md
├── apps/
├── packages/
└── scripts/
```

The final structure may evolve during implementation as long as the architectural boundaries defined in the master specification are preserved.

## Important Build Rules

- Do not redesign the product.
- Do not silently change locked requirements.
- Do not hardcode external providers where adapters are required.
- Do not expose production-resolution customer assets to the browser.
- Do not allow design downloads or exports.
- Do not auto-submit paid orders to Printify during the initial manual-review phase.
- Do not treat successful payment as equivalent to successful fulfillment.
- Do not skip prepress, moderation, security, or acceptance criteria.

## Execution Gates

The project includes six external execution gates:

- **G1** — AI Provider Benchmark
- **G2** — AI Unit Economics
- **G3** — Printify Product / Provider Qualification
- **G4** — US Sales Tax Configuration
- **G5** — Legal / Privacy Review
- **G6** — Physical Test Prints

These gates may block production readiness or launch, but should not unnecessarily block unrelated software implementation.

## Start Here

For Codex or any implementation agent:

1. Read `/docs/MASTER_BUILD_PROMPT.md` in full.
2. Inspect the current repository.
3. Map the repository against the specification.
4. Identify genuine blockers only.
5. Begin with **Milestone 0 — Foundation**.
6. Follow the reporting protocol defined in the master specification.

## Milestone 0 Foundation

The Foundation establishes a pnpm workspace modular monolith:

```text
apps/
  web/       Next.js application shell and health endpoint
  worker/    separate asynchronous-worker runtime
packages/
  config/          validated server configuration
  db/              PostgreSQL boundary and checked-in migrations
  domain/          platform domain ownership map
  observability/   structured logging and tracing helpers
  queue/           durable-queue abstraction and adapters
  storage/         private object-storage abstraction and adapters
  testing/         shared testing values
```

Read [the Foundation architecture](docs/architecture/foundation.md), [local development runbook](docs/runbooks/local-development.md), and the [ADRs](docs/decisions/README.md) before adding a domain feature.

Milestone 1 adds the guest-first identity, projects, product-selection, and autosave foundation described in [the Milestone 1 architecture](docs/architecture/milestone-1.md). The seeded product and price are development-only placeholders.

Milestone 2 adds provider-neutral generation orchestration, private generated-asset handling, attempt/credit persistence, deterministic development adapters, and the G1 benchmark harness. Read [the Milestone 2 architecture](docs/architecture/milestone-2.md) before changing AI workflows.

### Local setup

```powershell
Copy-Item .env.example .env
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:verify
pnpm dev
```

Run the complete local quality gate with:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
