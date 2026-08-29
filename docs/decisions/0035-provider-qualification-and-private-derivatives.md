# ADR 0035: Qualify provider candidates by product, provider, and decoration method

- Status: Accepted
- Date: 2026-08-30

## Context

Provider support is not a property of a T-shirt alone. G3 and G6 require evidence for a specific Product + Print Provider + Decoration Method combination, including a provider-specific production profile.

## Decision

`provider_qualifications` owns the candidate state, technical compatibility, G3 review state, physical-test state, reliability metadata, destination support, and routing notes. A candidate requires a mapped production profile through `provider_profile_mappings`. The development seed records are explicitly `UNQUALIFIED`, with G3 not reviewed and G6 `NOT_TESTED`.

Provider derivatives consume only a private Milestone 4 Production Master. The current derivative service copies an already compliant PNG only when its requirements match; it produces `REVIEW_REQUIRED` rather than silently resizing, re-encoding, or degrading an incompatible master. Every derivative has a private asset record and `PROVIDER_DERIVATIVE_SOURCE` lineage edge.

## Consequences

G3 can add or change qualification decisions without changing routing code. No development or synthetic test record constitutes production evidence. A real production transformation requires a later explicit provider-profile implementation and validation.
