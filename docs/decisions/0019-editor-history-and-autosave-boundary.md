# ADR 0019: Keep local undo history separate from project snapshots

- Status: Accepted
- Date: 2026-08-29

## Context

The editor needs responsive undo/redo without filling persistent version history with every pointer movement.

## Decision

Keep a bounded client-side command history (default 50) and commit continuous transforms only on completion. Debounce canonical autosave and use existing hash/revision behavior for immutable project snapshots and stale-write protection.

## Consequences

Undo remains fast and transient. Significant committed edits, generation insertion, and regeneration replacement are recoverable project versions without a diff engine.
