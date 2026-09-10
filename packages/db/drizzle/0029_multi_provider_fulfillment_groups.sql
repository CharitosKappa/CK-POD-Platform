CREATE TABLE app.checkout_fulfillment_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_attempt_id uuid NOT NULL REFERENCES app.checkout_attempts(id) ON DELETE RESTRICT,
  group_key text NOT NULL,
  adapter_type text NOT NULL CHECK (adapter_type IN ('PRINTIFY')),
  provider_id text NOT NULL REFERENCES app.print_providers(id) ON DELETE RESTRICT,
  qualification_id uuid NOT NULL REFERENCES app.provider_qualifications(id) ON DELETE RESTRICT,
  shipping_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'QUOTED' CHECK (status IN ('QUOTED', 'UNAVAILABLE', 'EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (checkout_attempt_id, group_key)
);
--> statement-breakpoint
CREATE TABLE app.checkout_fulfillment_group_items (
  fulfillment_group_id uuid NOT NULL REFERENCES app.checkout_fulfillment_groups(id) ON DELETE CASCADE,
  cart_item_id uuid NOT NULL REFERENCES app.cart_items(id) ON DELETE RESTRICT,
  item_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fulfillment_group_id, cart_item_id)
);
--> statement-breakpoint
CREATE TABLE app.order_fulfillment_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  checkout_fulfillment_group_id uuid REFERENCES app.checkout_fulfillment_groups(id) ON DELETE SET NULL,
  group_key text NOT NULL,
  adapter_type text NOT NULL CHECK (adapter_type IN ('PRINTIFY')),
  provider_id text NOT NULL REFERENCES app.print_providers(id) ON DELETE RESTRICT,
  qualification_id uuid NOT NULL REFERENCES app.provider_qualifications(id) ON DELETE RESTRICT,
  shipping_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ON_HOLD', 'READY_FOR_PRODUCTION', 'SUBMITTED', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED', 'FAILED', 'CANCELLED')),
  external_order_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, group_key)
);
--> statement-breakpoint
CREATE TABLE app.order_fulfillment_group_items (
  fulfillment_group_id uuid NOT NULL REFERENCES app.order_fulfillment_groups(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES app.order_items(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fulfillment_group_id, order_item_id),
  UNIQUE (order_item_id)
);
--> statement-breakpoint
CREATE INDEX checkout_fulfillment_groups_checkout_idx
  ON app.checkout_fulfillment_groups(checkout_attempt_id, created_at);
--> statement-breakpoint
CREATE INDEX order_fulfillment_groups_order_idx
  ON app.order_fulfillment_groups(order_id, created_at);
--> statement-breakpoint
INSERT INTO app.order_fulfillment_groups (
  order_id, group_key, adapter_type, provider_id, qualification_id, shipping_snapshot,
  status, external_order_id, created_at, updated_at
)
SELECT
  external_order.order_id,
  'legacy:' || external_order.id::text,
  external_order.adapter_type,
  qualification.provider_id,
  external_order.qualification_id,
  external_order.provider_snapshot,
  CASE external_order.submission_state
    WHEN 'SUBMITTED' THEN 'SUBMITTED'
    WHEN 'FAILED' THEN 'FAILED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    ELSE 'PENDING'
  END,
  external_order.external_order_id,
  external_order.created_at,
  external_order.updated_at
FROM app.external_fulfillment_orders external_order
JOIN app.provider_qualifications qualification ON qualification.id = external_order.qualification_id
ON CONFLICT (order_id, group_key) DO NOTHING;
--> statement-breakpoint
INSERT INTO app.order_fulfillment_group_items (fulfillment_group_id, order_item_id)
SELECT fulfillment_group.id, order_item.id
FROM app.order_fulfillment_groups fulfillment_group
JOIN app.order_items order_item ON order_item.order_id = fulfillment_group.order_id
WHERE fulfillment_group.group_key LIKE 'legacy:%'
ON CONFLICT (order_item_id) DO NOTHING;
