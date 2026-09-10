ALTER TABLE app.order_fulfillment_actions
  ADD COLUMN fulfillment_group_id uuid REFERENCES app.order_fulfillment_groups(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE app.order_fulfillment_actions
  DROP CONSTRAINT order_fulfillment_actions_order_id_action_key;
--> statement-breakpoint
CREATE UNIQUE INDEX order_fulfillment_actions_legacy_order_action_unique
  ON app.order_fulfillment_actions(order_id, action)
  WHERE fulfillment_group_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX order_fulfillment_actions_group_action_unique
  ON app.order_fulfillment_actions(fulfillment_group_id, action)
  WHERE fulfillment_group_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX order_fulfillment_actions_group_idx
  ON app.order_fulfillment_actions(fulfillment_group_id, created_at DESC)
  WHERE fulfillment_group_id IS NOT NULL;
