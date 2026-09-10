# Multi-provider fulfillment groups

## Purpose

Support carts containing products that Printify routes to different print providers, while preserving one customer checkout and one platform order. Printify remains the sole external fulfillment integration. The platform does not store or use credentials for individual print providers.

## Scope

- Evaluate every cart item independently at checkout.
- Group items into any number of provider-compatible fulfillment groups.
- Quote shipping per group and aggregate it into one customer-facing total.
- Persist immutable checkout, routing, and production data for every group and item.
- Create, submit, track, and retry external Printify orders per group.
- Keep the current mobile storefront presentation unchanged in this backend slice.
- Extend the deterministic fake fulfillment adapter and integration tests. Do not connect a real Printify shop or any other provider.

## Non-goals

- No live Printify credentials, real order submission, or live shipping quotes.
- No direct integrations with underlying print providers.
- No payment, AI, or email-provider work.
- No customer-facing split-shipment UI in this slice; the API will expose the data for that later work.

## Model

A platform order remains the customer and payment boundary. It contains one or more fulfillment groups. A group represents one compatible Printify fulfillment request and has one selected Printify print provider. Each order item belongs to exactly one group. A group may contain multiple compatible order items.

The platform must not assume a group is defined only by a provider ID. The group key also includes the Printify adapter, destination country, and any adapter-defined compatibility key needed to create one external request. This allows a future adapter to split a provider's items further without changing the order model.

Each fulfillment group has its own:

- checkout shipping quote and delivery estimate;
- selected provider qualification and routing decision;
- production derivative for each member item;
- external Printify order identifier and action history;
- fulfillment status and tracking events.

The order exposes an aggregate status. It is `PARTIALLY_SHIPPED` when at least one group has shipped and at least one has not. It becomes `SHIPPED` only when every active group has shipped, and `DELIVERED` only when every active group has delivered. A failed or held group does not cancel or block other groups.

## Checkout flow

1. Lock the cart and read its immutable item state.
2. Resolve eligible Printify provider candidates for every item.
3. Select a compatible provider/group for every item using the existing routing rules.
4. Request a shipping quote for each group using a batch-capable fulfillment contract.
5. If any item has no eligible group or quote, reject checkout before creating a payment intent. Return an item-specific availability reason.
6. Persist a checkout attempt with immutable line pricing and group shipping snapshots.
7. Aggregate subtotal, discount, group shipping, and tax into the existing one-payment checkout total.

## Post-payment flow

1. Create all order items from the frozen cart state.
2. Create fulfillment groups and attach each order item to exactly one group.
3. Evaluate production readiness per group. Every item needs its own approved proof, prepress run, policy result, mapping, and provider derivative.
4. Create one external Printify order per ready group. The normalized fulfillment contract accepts multiple line items, each carrying its mapped blueprint, provider, variant, quantity, and artwork reference.
5. Submit and reconcile every group independently. Provider webhook or polling events update the group first, then recalculate the aggregate platform order status.

## Failure and retry behavior

- Payment is never attempted until every item has a valid fulfillment group and quote.
- A verified successful payment remains financial evidence even if a quote expires while payment is completing.
- After payment, a failed group becomes `ON_HOLD` or `FAILED` at group level. Other groups remain eligible for submission.
- External-create and submission actions are idempotent per fulfillment group.
- A group retry reuses its own idempotency key and must not recreate or resubmit completed sibling groups.

## Persistence and compatibility

The migration introduces normalized fulfillment-group records and a group-to-order-item relation. It also migrates existing single-provider external fulfillment records into one group per existing order. Existing order APIs keep their aggregate fields; new group details are additive.

The current catalog has one product, so the new behavior is validated with seeded fake data representing multiple Printify providers. The data model itself does not limit the number of products, providers, groups, or shipments.

## Verification

Integration coverage must prove:

- two or more providers in one cart produce separate quoted groups and one checkout total;
- an item with no eligible provider prevents payment-intent creation;
- successful payment creates all groups and links every order item exactly once;
- one group can be held or fail without blocking another group's submission;
- partial shipment and full shipment aggregate statuses are correct;
- retries and duplicate external events are idempotent;
- existing single-group orders remain readable after migration.
