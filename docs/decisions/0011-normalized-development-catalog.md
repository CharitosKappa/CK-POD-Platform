# ADR 0011: Use a normalized internal development catalog

- Status: Accepted
- Date: 2026-08-29

## Context

Milestone 1 needs a selectable T-shirt product and color variants without beginning the Printify integration. Product logic must remain independent of Printify blueprints, providers, print areas, and decoration methods.

## Decision

Use `product_models` and `product_variants` as the platform catalogue boundary. Store reserved `fulfillment_mapping` JSON fields for the future normalized provider data, but do not populate them or call a provider. Seed one clearly marked development-only Essential DTG T-Shirt with Black, White, and Navy size variants, a placeholder image, and a $29.00 development price.

## Consequences

Project ownership and selection code work only with platform product IDs and color codes. Milestone 5 can add Printify blueprint, provider, print-area, and decoration tables/mappings without changing project semantics. The seed must not be treated as commercial pricing or production availability.
