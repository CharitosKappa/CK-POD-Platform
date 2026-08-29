# ADR 0031: Use an append-only, platform-owned style catalog

- Status: Accepted
- Date: 2026-08-29

## Context

Milestone 4.5 needs visual Style Family → Substyle choices that remain attributable after the catalog evolves. Names and slugs are mutable display data and cannot be the historical generation record.

## Decision

Store Style Families and Style Presets as normalized platform records. Each preset belongs to exactly one family. Store structured configuration in an append-only `style_preset_versions` table keyed by `(preset_id, version)` and preserve a family/preset/version triple on both projects and generations.

Family and preset activation is operational state; historical rows are never deleted. Database constraints enforce family/preset/version relationships, and a trigger prevents changing or deleting a version. New configuration requires a new version row.

## Consequences

Current selections use the latest active version. A stored generation or project can still resolve its historic version when a preset later becomes inactive. Repository-managed seed data is sufficient for MVP development; a future admin surface can activate, deactivate, reorder, add versions, and replace preview metadata without changing generation business logic.
