CREATE TABLE app.order_fulfillment_group_readiness_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_group_id uuid NOT NULL REFERENCES app.order_fulfillment_groups(id) ON DELETE RESTRICT,
  ready boolean NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX order_fulfillment_group_readiness_group_idx
  ON app.order_fulfillment_group_readiness_evaluations(fulfillment_group_id, created_at DESC);
