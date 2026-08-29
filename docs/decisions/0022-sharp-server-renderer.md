# ADR 0022: Use Sharp/libvips for deterministic server production rendering

- Status: Accepted
- Date: 2026-08-29

## Context

Milestone 4 requires a private server raster renderer independent of browser and Konva state.

## Decision

Use Sharp/libvips to compose canonical layers onto a transparent PNG. Render text paths to SVG first and rasterize them through Sharp. Do not export a browser canvas or use Konva serialization.

## Consequences

Rendering is independently testable and fits the Node modular monolith. Browser and server visual parity must continue to be checked as editor features evolve.
