# ADR 0015: Store generated source and preview assets in private object storage

- Status: Accepted
- Date: 2026-08-29

## Context

Generated source outputs are private platform assets and must not receive permanent public URLs.

## Decision

Persist source-output and preview asset records with private storage keys. The worker writes both through the existing private storage interface, then exposes only a controlled preview asset ID and metadata through an authorized generation-status API.

## Consequences

Browser responses do not expose source keys, provider payloads, or public URLs. Short-lived preview delivery, transformations, and production-master derivatives can be added without weakening this default.
