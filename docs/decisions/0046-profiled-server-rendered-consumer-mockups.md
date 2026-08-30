# ADR 0046: Profiled server-rendered consumer mockups

- Status: Accepted
- Date: 2026-08-30

## Context

Milestone 6 proof approval needs a credible photorealistic T-shirt preview rather than a flat garment-shaped composite. The proof must be deterministic, tied to the exact immutable design state, and remain isolated from Production Masters and provider derivatives.

## Decision

Use a platform-owned Sharp renderer with explicit versioned garment profiles. A profile is selected by platform product and color and records a blank-garment asset, chest placement, mask, integration settings, perspective capability, qualification state, and renderer version. The renderer consumes only the controlled `PREPRESS_PREVIEW`, creates a `MOCKUP_PROOF` private object, and persists its profile snapshot and artwork lineage. Its cache key includes project/version, prepress run/preview, product/color, profile/version, and renderer/version.

## Consequences

Proofs are deterministic consumer preview derivatives and may be securely delivered through the existing controlled-preview route. They never mutate the EditorDocument, Production Master, or provider derivative. The initial black, white, and navy assets are explicitly **DEVELOPMENT / UNQUALIFIED** generated photography; licensed launch photography must replace them through profile assets before production release without changing commerce or proof logic.
