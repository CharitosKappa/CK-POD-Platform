# Domain package

This package is the platform-owned, vendor-neutral domain boundary for the modular monolith. Future milestones add code under `src/modules/<module-name>` rather than placing domain logic in a Next.js route, queue worker, or provider adapter.

The planned module ownership is defined in `src/index.ts`. It follows the authoritative specification and intentionally contains no Milestone 1 behaviour yet.
