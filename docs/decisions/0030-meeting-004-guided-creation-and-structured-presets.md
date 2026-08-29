# ADR 0030: Meeting #004 — Guided Creation and Structured Preset Engine

- Status: Accepted
- Date: 2026-08-29

## Context

After the original master specification was written, Emergency Meeting #004 reviewed Kittl as a Tier-1 benchmark for AI creation and editing. The platform must preserve its consumer merchandise-commerce focus rather than react by becoming a general-purpose design tool.

Older product language described a small, flat list of approximately 6–10 style presets. That approach cannot represent a visual, evolving guided-creation system or provide stable analytics dimensions.

## Decision

Kittl is a benchmark for the quality and approachability of the creation experience, not a feature-parity target. The platform remains optimized for consumers who need little design expertise:

```text
Idea → Guided Style → AI T-shirt Design → Simple Editing → Print Validation → Product Preview → Checkout → Production → Delivery
```

The flat 6–10 preset requirement is superseded. The product will use a hierarchical, visual Style Family → Substyle system. A preset is a versioned, structured platform record, not only a hardcoded prompt suffix. It carries stable identifiers, visual display metadata, provider-neutral conditioning and composition guidance, typography, colour, texture/detail, print constraints, and optional routing hints.

The user’s idea remains central. Provider-specific prompt translation stays behind the existing task-oriented AI abstraction. Generation records and future analytics events preserve stable `styleFamilyId`, `presetId`, and `presetVersion` identifiers.

Milestone 4.5 is inserted between approved Milestone 4 and Milestone 5 to implement this foundation. It must integrate with—not replace—Milestone 2 orchestration, Milestone 3 canonical documents, and Milestone 4 prepress.

## Consequences

The next implementation task is Milestone 4.5. It will add structured preset persistence, guided visual selection, provider-neutral conditioning, deterministic local-provider support, and analytics-ready identifiers without adding a template marketplace, general-purpose editor features, Printify integration, routing, or checkout.

Approved Milestones 0–4 remain unchanged. Milestone 5 follows Milestone 4.5 and remains Printify Integration & Fulfillment Routing.
