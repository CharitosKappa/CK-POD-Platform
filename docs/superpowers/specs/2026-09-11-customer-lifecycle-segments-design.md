# Customer lifecycle segments

The Customers directory separates operational recency from ecommerce purchase lifecycle:

- **Recently added:** first seen in the last 30 days, whether or not a purchase exists.
- **Prospects:** no qualifying orders.
- **First-time:** exactly one qualifying order.
- **Returning:** two or more qualifying orders.

Qualifying orders use the existing customer order summary and exclude `DRAFT`, `PAYMENT_PENDING`, `CANCELLED`, and `FAILED` orders. The segments may overlap only where their meanings allow it: a recently added profile can also be a prospect, first-time, or returning customer. Purchase-lifecycle segments are mutually exclusive.

The dashboard metric is named **Repeat customer rate** and remains the percentage of purchasing customers with two or more qualifying orders. Existing saved `NEW` views and queued export snapshots migrate to `RECENTLY_ADDED` at their boundaries.
