# Multi-provider fulfillment groups — implementation plan

## Slice 1: normalized data model

1. Add a migration for `checkout_fulfillment_groups`, `order_fulfillment_groups`, and `order_fulfillment_group_items`.
2. Store provider, adapter, compatibility key, group shipping snapshot, status, and lifecycle timestamps on the group records.
3. Link every group item to one `order_items` row with a uniqueness constraint.
4. Migrate existing `external_fulfillment_orders` into one group per order and preserve existing external order IDs.
5. Add aggregate order state support for `PARTIALLY_SHIPPED` while keeping existing single-group order reads compatible.

## Slice 2: batch-capable fulfillment contract and checkout quote

1. Replace single-variant shipping quote input with a line-item request that carries Printify blueprint, provider, variant, and quantity for a compatible group.
2. Update the fake adapter to quote deterministic shipping per group and accept multiple order lines.
3. Keep the real Printify adapter behind its existing capability boundary; update only its normalized request shape, without enabling live calls.
4. Add checkout routing resolution for every cart item, build compatibility groups, quote every group, and aggregate shipping into the existing payment total.
5. Persist the frozen group snapshots before payment intent creation. Reject checkout before payment when any line lacks eligibility or a quote.

## Slice 3: paid order materialization

1. Materialize order items and order fulfillment groups from the frozen checkout data after verified payment.
2. Create the order-item/group relationships atomically.
3. Keep customer-facing `getOrder` aggregate fields unchanged; add group details to operations reads only.
4. Ensure duplicate payment events do not duplicate groups or item links.

## Slice 4: per-group operations

1. Replace single-row routing/readiness queries with group-aware item collections.
2. Evaluate routing, policy, proofs, prepress, mappings, and derivatives for every item in a group.
3. Create external Printify orders per ready group and submit/retry them independently with group-scoped idempotency keys.
4. Reconcile provider events against the group, then derive the aggregate order status from all groups.
5. Preserve the current operational APIs for single-group orders during the transition.

## Slice 5: verification and delivery

1. Extend integration fixtures to represent at least two Printify providers and multiple eligible cart items.
2. Test group quote aggregation, unavailable-line checkout rejection, payment idempotency, partial shipment, group failure isolation, retries, and migration compatibility.
3. Run migrations against the isolated test database, full integration tests, type checks, lint, and formatter.
4. Keep the storefront UI unchanged. The follow-up slice will expose split-shipping and tracking details to customers once the catalog has real multi-provider products.

## Delivery order

Implement and verify slices 1–3 as the first backend migration. Slices 4–5 follow in the same change only if their integration tests remain bounded and the existing operations API can remain compatible; otherwise they are committed as the next isolated backend slice. No real Printify, payment, email, or AI connection is enabled in either case.
