# ADR 0041: Provisional checkout shipping

- Status: Accepted
- Date: 2026-08-30

## Context

Checkout needs delivery information before the later final-routing workflow.

## Decision

Use normalized fulfillment quotes strictly as provisional shipping snapshots. Do not create or select a final routing decision at checkout.

## Consequences

The paid order remains eligible for independent Milestone 7 review and routing.
