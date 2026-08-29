# ADR 0020: Use stable bundled open-font identifiers in the editor

- Status: Accepted
- Date: 2026-08-29

## Context

Exact text needs future deterministic production rendering and cannot rely on fonts installed on a customer device.

## Decision

Bundle a small curated set of SIL Open Font License families through Fontsource and store stable IDs: `inter`, `oswald`, and `playfair-display`.

## Consequences

Browser display is deterministic enough for the MVP and a future renderer can resolve the same stable IDs. Font expansion remains deliberately curated.
