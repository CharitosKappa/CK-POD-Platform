# ADR 0024: Render approved fonts as bundled OpenType glyph paths

- Status: Accepted
- Date: 2026-08-29

## Context

Production text cannot rely on arbitrary host fonts or browser measurement.

## Decision

Resolve the Milestone 3 Fontsource files by stable font ID and weight, parse them server-side, and rasterize explicit glyph paths. Missing fonts fail the run; there is no silent system fallback.

## Consequences

Text remains deterministic for the curated font set. Complex-script shaping and font expansion require a deliberate future renderer decision.
