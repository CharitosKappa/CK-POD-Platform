# ADR 0016: Use a versioned, provider-neutral G1 benchmark harness

- Status: Accepted
- Date: 2026-08-29

## Context

G1 needs repeatable provider comparison but Milestone 2 must not manufacture a provider winner or pretend human quality scores are automatic.

## Decision

Version benchmark cases as JSON, run each case against every configured capable provider, and emit structured attempt, latency, and cost results. Accept manual-score imports for the locked weighted categories. Include a small deterministic development fixture and document the full-dataset command.

## Consequences

The harness is ready for real candidate credentials and the complete benchmark dataset. Human quality, print-suitability, reference, editing, and typography evaluation remains a required G1 activity.
