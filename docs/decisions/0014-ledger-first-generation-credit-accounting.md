# ADR 0014: Consume generation credits only on validated delivery

- Status: Accepted
- Date: 2026-08-29

## Context

The locked credit rule is one credit per valid generation actually delivered to the user. Provider and internal retries must not bill the user.

## Decision

Use an append-only ledger and a row-locked account balance projection. Grant a configurable guest allowance of one credit by default and a configurable registered allowance of zero pending G2. Consume one credit in the same transaction that marks the generation as delivered; the ledger idempotency key and unique consume entry prevent double consumption.

## Consequences

Provider failures, timeouts, moderation rejections, validation rejections, and queue retries remain non-consumptive. Paid packs and final allowance economics remain out of scope until G2.
