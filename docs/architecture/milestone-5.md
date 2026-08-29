# Milestone 5 — Printify Integration & Fulfillment Routing

## Scope

Milestone 5 adds the provider-neutral fulfillment boundary, persisted Printify mappings, catalog synchronization, provider qualification data, shipping normalization, trusted Ops matrix, and platform-owned routing. It does not add checkout, payment, customer shipping presentation, an order state machine, automatic provider order creation, or automatic production submission.

## Boundary

```text
Internal product and variant IDs
  → allowlisted Printify mapping data
  → Product + Provider + Decoration candidate
  → platform eligibility and ranking
  → FulfillmentService adapter
```

`FulfillmentService` normalizes catalog data, shipping quotes, future idempotent order contracts, status lookups, and webhook verification. Only `PrintifyFulfillmentAdapter` knows Printify HTTP endpoints. The default `FakePrintifyFulfillmentAdapter` is deterministic and contains no credential requirement. `FULFILLMENT_ADAPTER=printify` explicitly enables real mode and requires server-only `PRINTIFY_API_TOKEN` and `PRINTIFY_SHOP_ID`.

Printify Order Routing is not used by M5. The persisted routing configuration records it as disabled by default. Payment and order flows cannot reach adapter order creation or production submission because those flows do not exist until later milestones.

## Catalog and qualification data

Platform product and variant IDs remain canonical. `fulfillment_product_mappings` and `fulfillment_variant_mappings` hold external blueprint/variant identifiers; `print_providers` and `provider_variants` represent observed external availability. Sync only reads local allowlisted blueprint mappings. It marks removed external entities unavailable and never deletes historical mappings or local qualification settings.

`provider_qualifications` represents the exact Product + Provider + Decoration Method candidate. It tracks technical compatibility, qualification status, G3 review, physical-test state, reliability data, destination/shipping capability, and notes. `provider_profile_mappings` binds the candidate to a Milestone 4 production profile. Development candidates are intentionally `UNQUALIFIED`, G3-unreviewed, and `NOT_TESTED`; they cannot route.

## Production masters and derivatives

The M4 hierarchy remains unchanged:

```text
Editable Master → Production Master (private) → Provider Derivative (private)
```

`ProviderDerivativeService` accepts a passed/review-required prepress run and a provider-profile mapping. It only creates an identical private PNG derivative when the master already meets content-type, dimensions, and size requirements. Any mismatch becomes `REVIEW_REQUIRED`; no silent quality-degrading transform occurs. The new asset has an `asset_lineage` edge back to the exact Production Master and is never a consumer preview type.

## Routing

Eligibility emits structured exclusions for disabled/suspended/unavailable providers, non-approved or inactive qualification, incompatibility, unavailable variants, unsupported destinations, shipping absence, missing profile, prepress not ready, margin-floor failure, and landed-cost ceiling failure.

Eligible candidates are ranked with persisted weights in this order:

1. Compatibility
2. Availability
3. Quality/reliability
4. Delivery estimate
5. Landed cost

The ranking is deterministic; provider ID is its tie-breaker. `routing_evaluations` stores request and decision snapshots, including all candidates, exclusion codes, normalized quotes, landed cost, score components, selected candidate, and routing configuration version. This is internal-only explainability.

## Ops and security

`FULFILLMENT_ADMIN` is an operationally assigned user role. The protected `/ops/providers` matrix and `/api/ops/fulfillment/*` endpoints require it; consumers and guest sessions receive no provider economics, routing snapshots, profile requirements, or administration controls. Production masters and derivatives remain inaccessible through the controlled-preview asset service.

Printify webhooks are verified before normalized, idempotent event persistence. Unknown events are retained as normalized infrastructure records without starting the later order state machine.

## G3 and G6 workflow

M5 makes the following technical workflow possible:

1. Sync an allowlisted catalog/provider combination.
2. Confirm product, color, and size availability.
3. Create a Product + Provider + Decoration candidate.
4. Bind a provider-specific production profile and cost/shipping data.
5. Render a representative private provider derivative.
6. Run physical samples and record placement, detail, color, transparency, cost, delivery, and reliability evidence.
7. Record G3 review and G6 physical-test outcome.
8. Mark the candidate `QUALIFIED` and active only after evidence.

No real combination is qualified by this implementation. G3 and G6 remain open execution gates.
