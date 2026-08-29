# ADR 0013: Persist generation lifecycle before queue execution

- Status: Accepted
- Date: 2026-08-29

## Context

Image generation is external, slow, fallible work and must not complete inside a browser request.

## Decision

Persist a `Generation` in `QUEUED` state, enqueue it through the existing queue contract, then let the worker claim it. Persist every provider/model attempt. Use bounded per-provider retries and configuration-controlled fallback. A repeated job only claims `QUEUED` work, making delivered generations idempotent.

## Consequences

The web process responds without awaiting durable-worker generation. In-memory queue execution is asynchronous for tests/local use; Redis/BullMQ is the separate worker path. A stale `PROCESSING` recovery policy belongs to hardening and operations runbooks.
