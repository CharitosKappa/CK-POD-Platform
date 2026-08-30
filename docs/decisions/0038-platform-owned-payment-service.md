# ADR 0038: Platform-owned PaymentService

- Status: Accepted
- Date: 2026-08-30

## Context

Milestone 6 requires Stripe without coupling checkout and orders to Stripe APIs.

## Decision

Use a `PaymentService` contract with deterministic fake and Stripe PaymentIntent adapters. Commerce depends only on this contract.

## Consequences

Local/CI payment behavior is deterministic; Stripe credentials and card details remain outside domain code.
