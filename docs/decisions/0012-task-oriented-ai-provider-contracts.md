# ADR 0012: Use task-oriented AI provider contracts with deterministic local adapters

- Status: Accepted
- Date: 2026-08-29

## Context

Milestone 2 requires generation now while G1 prohibits permanently selecting a final image provider or model.

## Decision

Route AI work through platform tasks and `ImageGenerationService`, configured by provider capability, priority, model identifier, cost metadata, timeout, retry policy, and fallback eligibility. Ship two deterministic adapters for local development and CI: SVG primary and pattern fallback.

## Consequences

Business code has no provider SDK dependency and provider selection can change through configuration. The deterministic adapters prove orchestration only; they are not production AI. Real-provider credentials and comparative selection remain gated by G1.
