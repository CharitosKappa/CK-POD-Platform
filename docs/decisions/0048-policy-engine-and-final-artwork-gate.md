# ADR 0048: Policy engine and final-artwork compliance gate

## Status

Accepted for Milestone 8; G5 remains open.

## Decision

The platform owns policy semantics through `PolicyService`. Classifiers are provider-neutral adapters
that map their output into platform categories and one of `ALLOW`, `BLOCK`, `REVIEW`, or `UNKNOWN`.
Every evaluation stores the ruleset identifier, stage, artifact/project-version linkage, structured
findings, classifier identity, and immutable classifier response.

`PROMPT_PRE_GENERATION`, `REFERENCE_UPLOAD`, `GENERATED_OUTPUT`, and
`FINAL_ARTWORK_PRE_PRODUCTION` are distinct stages. A final-artwork evaluation is bound to the exact
order project version and production-master reference. New evaluations are appended for re-evaluation;
history is never overwritten.

Machine outcomes remain independent from trusted human decisions. `BLOCK` cannot be made production
eligible by an order-review approval. `REVIEW` and `UNKNOWN` require a separately persisted trusted
human decision before readiness. Final readiness rejects missing, blocked, and unresolved evaluations.

## Consequences

Generation input blocks happen before provider execution and credit consumption. Generated and reference
artwork is evaluated before delivery. The deterministic classifier is intentionally conservative and is
used only for local/CI fixtures; a future provider must implement the policy-classifier contract rather
than leaking provider taxonomy into routes or orders.

This is technical risk control, not a legal clearance, copyright guarantee, or completion of G5.
