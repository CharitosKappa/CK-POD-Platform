# ADR 0006: Use redacting structured logs with OpenTelemetry-compatible spans

- Status: Accepted
- Date: 2026-08-29

## Context

The platform needs structured diagnostics for provider failures and future metrics without leaking customer data, credentials, or raw provider responses.

## Decision

Provide a platform logger that writes JSON records and recursively redacts sensitive field names. Provide an OpenTelemetry API-compatible `withSpan` helper while leaving exporter selection to deployment configuration.

## Consequences

Application code has a stable observability contract before any vendor is selected. A production telemetry exporter, metric backend, alert policy, and PII field allow-list must be configured during hardening; no credential-bearing data may be passed as span attributes.
