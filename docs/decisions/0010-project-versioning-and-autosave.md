# ADR 0010: Store immutable project snapshots with optimistic revisions

- Status: Accepted
- Date: 2026-08-29

## Context

Projects need a platform-owned editor-document foundation before an editor exists, plus safe autosave and future snapshot compatibility.

## Decision

Store JSON editor documents as immutable `project_versions` with a stable document hash. Projects store an active version and integer revision. Autosave creates a version only when the document hash changes and uses the expected project revision for optimistic conflict detection. Keep the configured newest 20 snapshots by default.

## Consequences

No canvas-library state or diff algorithm is required. A stale client receives a conflict and can fetch current project state before retrying. Generation and destructive-edit snapshot reasons are reserved in the schema but not implemented.
