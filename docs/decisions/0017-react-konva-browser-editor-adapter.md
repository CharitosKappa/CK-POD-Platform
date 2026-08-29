# ADR 0017: Use React Konva only as the browser editor adapter

- Status: Accepted
- Date: 2026-08-29

## Context

Milestone 3 needs a touch-capable 2D scene graph without allowing a canvas library to own project data.

## Decision

Use React Konva for browser rendering, hit testing, dragging, and transformer handles. Translate committed browser transforms into editor-schema commands; never save Konva JSON.

## Consequences

The editor remains practical on desktop and mobile while server rendering can use the same canonical schema without importing Konva.
