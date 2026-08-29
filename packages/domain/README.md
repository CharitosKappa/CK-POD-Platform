# Domain package

This package is the platform-owned, vendor-neutral domain boundary for the modular monolith. Domain behavior belongs here rather than in a Next.js route, queue worker, or provider SDK adapter.

Implemented foundations cover identity/projects, generation orchestration, editor persistence, prepress, structured style selection, and Milestone 5 fulfillment routing. Fulfillment code owns the internal adapter contract, catalog synchronization, candidate qualification, private derivative boundary, shipping normalization, and explainable routing; `printify.ts` is the only Printify-specific implementation module.

See [Milestone 5 architecture](../../docs/architecture/milestone-5.md) and ADRs 0034–0037 before changing fulfillment behavior.
