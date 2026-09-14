# Order Net Payment Design

## Goal

Make the refunded order financial summary follow Shopify's accounting hierarchy while keeping every displayed value connected to persisted order and refund data.

## Presentation

The payment card keeps the immutable order-value rows (`Subtotal`, `Discounts`, `Shipping`, `Taxes`, and `Total`). The settlement rows follow beneath a divider:

1. `Paid` shows the captured amount and the persisted payment-method label.
2. `Refunded` appears only when completed refunds exist. It shows the completed refunded amount as a negative value. Its detail column identifies the actual refund destination (`Credit card`, `Store credit`, or both) and includes the persisted refund reason when one unambiguous reason applies.
3. `Net payment` appears after `Refunded` and equals `paidCents - refundedCents`. A fully refunded order therefore shows `$0.00`.

Pending or failed refund requests do not reduce `Net payment`; they retain their existing separate presentation.

## Data boundary

The order-detail read model will expose completed refund summaries sourced from `app.order_refunds`. Each entry contains only admin-safe presentation data: destination, amount, reason code, and completion timestamp. Original-payment refunds use the order's persisted payment-method label; store-credit refunds use `Store credit`. Persisted reason codes are normalized into readable labels (for example, `ORDER_CANCELLED` becomes `Order cancelled`). No refund destination or reason is inferred from the order status.

The existing aggregate `refundedCents` remains the monetary authority for the displayed refunded amount and net-payment calculation. The completed-refund records provide the descriptive middle-column context.

## Multiple refunds

When completed refunds span multiple destinations, the detail column combines the unique labels (for example, `Credit card + Store credit`). A single shared reason is displayed as `Reason: “…”`; differing reasons are summarized as the number of refunds instead of presenting a misleading single reason.

## Validation

Tests cover:

- a partial original-payment refund;
- a full refund producing `$0.00` net payment;
- a mixed original-payment and store-credit refund;
- pending refunds remaining excluded from the net payment;
- domain serialization of completed refund metadata from persisted rows.

No refund mutation behavior, payment processing, or timeline behavior changes in this work.
