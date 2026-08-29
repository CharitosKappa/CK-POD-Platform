# ADR 0036: Use two-stage, explainable platform routing

- Status: Accepted
- Date: 2026-08-30

## Context

Provider routing must protect compatibility and economics while remaining debuggable and historically reproducible. Printify's own routing cannot make this decision for the platform.

## Decision

Routing first evaluates structured eligibility exclusions: operational provider status, external availability, qualification/G3/G6 state, technical compatibility, variant availability, destination, shipping, provider profile, prepress readiness, landed-cost ceiling, and contribution floor. Eligible candidates then receive configurable ranking components in this locked order: compatibility, availability, quality/reliability, delivery, then landed cost. Stable provider-ID ordering breaks ties.

Every evaluation stores request and decision snapshots with candidate exclusions, normalized shipping, landed cost, ranking components, selected qualification, and routing configuration version. Routing configuration is persisted and externalized; Printify Order Routing fallback is represented as disabled by default.

## Consequences

Internal Ops can explain a result without querying current provider configuration. The initial development thresholds are not commercial pricing decisions and must be revalidated with G2/G3 data.
