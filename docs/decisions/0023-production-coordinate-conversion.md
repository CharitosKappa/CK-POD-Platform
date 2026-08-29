# ADR 0023: Map normalized print-area coordinates directly to production profile pixels

- Status: Accepted
- Date: 2026-08-29

## Context

Editor placement must remain invariant across browser viewports and production output.

## Decision

Layer centres and dimensions are normalized to the print area. Multiply them by profile raster dimensions and physical inches; crop, resize, opacity, and clockwise centre rotation occur in that order.

## Consequences

The same canonical document has deterministic physical placement. Profile dimensions, not viewport dimensions, control output.
