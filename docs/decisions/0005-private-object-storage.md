# ADR 0005: Use a private S3-compatible object-storage contract

- Status: Accepted
- Date: 2026-08-29

## Context

Production masters must remain private and never receive permanent browser URLs. Storage must still support local development without external credentials.

## Decision

Expose only a `PrivateObjectStorage` interface with put, get, exists, and delete operations. Implement an S3-compatible adapter and an in-memory local/test adapter. Do not offer any public-URL method in the contract.

## Consequences

Asset classification and short-lived operational access are designed in their asset-owning milestone without weakening the private default. Bucket policy, encryption, retention, and credential provisioning remain deployment responsibilities and must be completed before production use.
