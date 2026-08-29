# ADR 0033: Use data-driven development visual metadata and stable preset attribution

- Status: Accepted
- Date: 2026-08-29

## Context

Consumers should choose styles visually, but Milestone 4.5 must not introduce a template marketplace or dynamically generate preview imagery. Future analytics need stable preset dimensions rather than labels.

## Decision

The development catalog stores controlled visual metadata for every family and preset. The guided UI renders locally managed gradient artwork from this metadata, alongside a concise name and description. The public catalog API returns only this consumer-safe data.

Generation records persist `style_family_id`, `style_preset_id`, `style_preset_version`, and `style_selection_mode`. `AUTO` selections are deterministically resolved to a concrete preset before generation so attribution is never silently lost.

## Consequences

Curated production preview assets can replace development visual metadata later without changing the catalog or selection contract. Future analytics can segment generation, conversion, AOV, refund/reprint, and product/colour performance by stable identifiers. Thumbnail curation and preset operations remain an editorial responsibility, not a consumer feature.
