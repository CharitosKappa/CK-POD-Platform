ALTER TABLE app.orders DROP CONSTRAINT orders_status_check;
--> statement-breakpoint
ALTER TABLE app.orders ADD CONSTRAINT orders_status_check CHECK (
  status IN (
    'DRAFT', 'PAYMENT_PENDING', 'PAID', 'PREPRESS_REVIEW', 'COMPLIANCE_REVIEW',
    'ROUTING', 'READY_FOR_PRODUCTION', 'SUBMITTED_TO_PRINTIFY', 'IN_PRODUCTION',
    'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'ON_HOLD', 'FAILED', 'CANCELLED',
    'REPRINT_REQUIRED', 'REFUND_REQUIRED'
  )
);
--> statement-breakpoint
ALTER TABLE app.order_shipments
  ADD COLUMN fulfillment_group_id uuid REFERENCES app.order_fulfillment_groups(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE app.order_shipments
  DROP CONSTRAINT order_shipments_order_id_tracking_number_key;
--> statement-breakpoint
CREATE UNIQUE INDEX order_shipments_legacy_order_tracking_unique
  ON app.order_shipments(order_id, tracking_number)
  WHERE fulfillment_group_id IS NULL AND tracking_number IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX order_shipments_group_tracking_unique
  ON app.order_shipments(fulfillment_group_id, tracking_number)
  WHERE fulfillment_group_id IS NOT NULL AND tracking_number IS NOT NULL;
--> statement-breakpoint
CREATE INDEX order_shipments_group_idx
  ON app.order_shipments(fulfillment_group_id, created_at DESC)
  WHERE fulfillment_group_id IS NOT NULL;
