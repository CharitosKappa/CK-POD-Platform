# ADR 0018: Use a versioned normalized canonical editor document

- Status: Accepted
- Date: 2026-08-29

## Context

Placement must survive viewport changes and later server rendering while Milestone 1 snapshots remain readable.

## Decision

Use `EditorDocumentV1` in a pure `@let-it-be/editor-schema` package. Layer geometry is normalized to its print area; rotations are clockwise around centre and crops are normalized source rectangles. Legacy placeholder documents migrate on read without rewriting old versions.

## Consequences

The schema is library-independent and forwards-compatible. The development print profile remains explicitly non-production until Milestone 4/5 supplies validated profiles.
