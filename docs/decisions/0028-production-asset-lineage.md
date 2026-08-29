# ADR 0028: Store production-master lineage as private asset relationships

- Status: Accepted
- Date: 2026-08-29

## Context

Review and later provider derivatives need traceability to the exact project version and sources.

## Decision

Persist a prepress run for its project version and profile, private production/preview asset records, renderer/output metadata, and `asset_lineage` edges from master to every source asset.

## Consequences

The system can trace a master and later derivative without exposing asset keys through consumer APIs.
