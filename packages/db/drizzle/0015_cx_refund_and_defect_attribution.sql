--> statement-breakpoint
ALTER TABLE app.order_refunds ALTER COLUMN provider_refund_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app.provider_defects
  ADD COLUMN order_item_id uuid REFERENCES app.order_items(id) ON DELETE SET NULL,
  ADD COLUMN product_model_id text REFERENCES app.product_models(id) ON DELETE SET NULL,
  ADD COLUMN product_variant_id text REFERENCES app.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN external_fulfillment_order_id uuid REFERENCES app.external_fulfillment_orders(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX provider_defects_analytics_idx
  ON app.provider_defects(provider_id, product_model_id, product_variant_id, created_at DESC);
