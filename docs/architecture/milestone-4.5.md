# Milestone 4.5 — Guided Creation & Structured Preset Engine

## Status and scope

Milestone 4.5 is implemented as an additive extension to the approved Milestone 2–4 architecture. It does not begin Printify, fulfillment routing, checkout, or a general-purpose template/editor system.

Milestone 4.5 inserts guided creation between approved prepress work and Milestone 5 Printify/routing work. It extends the existing provider-neutral generation architecture and remains compatible with projects, immutable project versions, `EditorDocumentV1`, private generated assets, and the Milestone 4 prepress lifecycle.

## Product outcome

The consumer keeps their idea at the centre and is guided through a visual choice:

```text
Choose product / colour → Describe idea → Style Family → Substyle → Generate
```

The interface should show thumbnail/example artwork, a concise name, and an optional short description. It must not expose model names, prompt weights, samplers, rendering engines, lighting controls, or other professional prompt-engineering controls.

## Platform model

The platform will own structured, versioned preset data:

- Style Family: stable ID and display metadata
- Substyle / Preset: stable ID, family relationship, display metadata, and visual preview metadata
- Preset version: immutable configuration used for a generation, including conditioning, composition, typography, colour, texture/detail, print constraints, and optional provider-neutral routing hints

Style Families, presets, and append-only preset versions are persisted in PostgreSQL. Projects and generations preserve `styleFamilyId`, `presetId`, `presetVersion`, and `selectionMode`. Product and selected-colour context remains part of the request. Provider adapters receive translated conditioning through existing task-oriented contracts; no business code depends on an individual provider’s prompt format.

## Compatibility and boundaries

- Existing generation data remains readable when it has no preset selection.
- Existing projects, project versions, editor documents, assets, generation lifecycle, credit ledger, and prepress records remain compatible through additive migration `0005_guided_style_presets`.
- Deterministic local/fake providers accept the structured request and use stable preset IDs in their deterministic output seed.
- The old flat approximately 6–10 preset requirement is superseded by Meeting #004; a fixed catalog is not encoded in application logic.

Out of scope: generic template marketplace, Kittl-style general design tools, Printify integration, fulfillment routing, checkout, and any change to approved prepress semantics.

## Analytics preparation

Event and reporting design must make it possible to calculate generations, successful generations, generations per order, generation-to-purchase conversion, AOV, refund/reprint rate, and product/colour performance by Style Family, preset, and preset version.

## Consumer and operational behavior

The describe page keeps the idea first, then presents five visual family cards and the selected family’s four development substyles. The mobile layout uses a two-column card grid, large touch targets, and an accessible primary CTA. `Let AI Decide` persists `AUTO`; the server resolves and persists a concrete preset before generation.

The development catalog is repository-managed seed data. Future operations can activate/deactivate a family or preset, reorder it, append a version, and replace its visual metadata without changing generation business logic. It deliberately has no admin UI in this milestone.
