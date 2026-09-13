ALTER TABLE app.order_fulfillment_groups
  ADD COLUMN printing_status text,
  ADD COLUMN fulfillment_status text,
  ADD COLUMN last_provider_sync_at timestamptz,
  ADD COLUMN production_economics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
UPDATE app.order_fulfillment_groups AS fulfillment_group
SET printing_status = CASE fulfillment_group.status
      WHEN 'PENDING' THEN 'NOT_STARTED'
      WHEN 'ON_HOLD' THEN 'ON_HOLD'
      WHEN 'READY_FOR_PRODUCTION' THEN 'READY_FOR_PRODUCTION'
      WHEN 'SUBMITTED' THEN 'SUBMITTED'
      WHEN 'IN_PRODUCTION' THEN 'IN_PRODUCTION'
      WHEN 'SHIPPED' THEN 'PRINTED'
      WHEN 'DELIVERED' THEN 'PRINTED'
      WHEN 'FAILED' THEN 'FAILED'
      WHEN 'CANCELLED' THEN 'CANCELLED'
      ELSE 'NOT_STARTED'
    END,
    fulfillment_status = CASE
      WHEN EXISTS (
        SELECT 1 FROM app.order_shipments shipment
        WHERE shipment.fulfillment_group_id = fulfillment_group.id
          AND (shipment.delivered_at IS NOT NULL OR lower(shipment.status) = 'delivered')
      ) THEN 'DELIVERED'
      WHEN fulfillment_group.status = 'DELIVERED' THEN 'DELIVERED'
      WHEN EXISTS (
        SELECT 1 FROM app.order_shipments shipment
        WHERE shipment.fulfillment_group_id = fulfillment_group.id
          AND (shipment.shipped_at IS NOT NULL OR lower(shipment.status) IN ('shipped','delivered'))
      ) THEN 'FULFILLED'
      WHEN fulfillment_group.status = 'SHIPPED' THEN 'FULFILLED'
      WHEN fulfillment_group.status = 'CANCELLED' THEN 'CANCELLED'
      ELSE 'UNFULFILLED'
    END;
--> statement-breakpoint
ALTER TABLE app.order_fulfillment_groups
  ALTER COLUMN printing_status SET DEFAULT 'NOT_STARTED',
  ALTER COLUMN printing_status SET NOT NULL,
  ALTER COLUMN fulfillment_status SET DEFAULT 'UNFULFILLED',
  ALTER COLUMN fulfillment_status SET NOT NULL,
  ADD CONSTRAINT order_fulfillment_groups_printing_status_check CHECK (
    printing_status IN (
      'NOT_STARTED','PREPRESS_REVIEW','COMPLIANCE_REVIEW','READY_FOR_PRODUCTION',
      'SUBMITTING','SUBMITTED','IN_PRODUCTION','PRINTED','ON_HOLD','FAILED','CANCELLED'
    )
  ),
  ADD CONSTRAINT order_fulfillment_groups_fulfillment_status_check CHECK (
    fulfillment_status IN ('UNFULFILLED','PARTIALLY_FULFILLED','FULFILLED','DELIVERED','CANCELLED')
  );
--> statement-breakpoint
CREATE TABLE app.order_printing_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  fulfillment_group_id uuid NOT NULL REFERENCES app.order_fulfillment_groups(id) ON DELETE RESTRICT,
  from_state text,
  to_state text NOT NULL CHECK (
    to_state IN (
      'NOT_STARTED','PREPRESS_REVIEW','COMPLIANCE_REVIEW','READY_FOR_PRODUCTION',
      'SUBMITTING','SUBMITTED','IN_PRODUCTION','PRINTED','ON_HOLD','FAILED','CANCELLED'
    )
  ),
  source text NOT NULL CHECK (source IN ('SYSTEM','OPS','WEBHOOK','POLLING','MIGRATION')),
  external_event_id text,
  raw_status text,
  disposition text NOT NULL DEFAULT 'APPLIED' CHECK (disposition IN ('APPLIED','DUPLICATE','CONFLICT','UNKNOWN')),
  actor_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX order_printing_status_events_order_idx
  ON app.order_printing_status_events(order_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX order_printing_status_events_group_idx
  ON app.order_printing_status_events(fulfillment_group_id, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX order_printing_status_events_external_unique
  ON app.order_printing_status_events(fulfillment_group_id, external_event_id)
  WHERE external_event_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE app.order_fulfillment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  fulfillment_group_id uuid NOT NULL REFERENCES app.order_fulfillment_groups(id) ON DELETE RESTRICT,
  from_state text,
  to_state text NOT NULL CHECK (
    to_state IN ('UNFULFILLED','PARTIALLY_FULFILLED','FULFILLED','DELIVERED','CANCELLED')
  ),
  source text NOT NULL CHECK (source IN ('SYSTEM','OPS','WEBHOOK','POLLING','MIGRATION')),
  shipment_id uuid REFERENCES app.order_shipments(id) ON DELETE SET NULL,
  actor_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX order_fulfillment_status_history_order_idx
  ON app.order_fulfillment_status_history(order_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX order_fulfillment_status_history_group_idx
  ON app.order_fulfillment_status_history(fulfillment_group_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE app.order_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_by_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX order_notes_order_idx ON app.order_notes(order_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE app.order_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  value text NOT NULL CHECK (length(value) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX order_tags_value_case_insensitive_idx ON app.order_tags(lower(value));
--> statement-breakpoint
CREATE TABLE app.order_tag_assignments (
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE CASCADE,
  order_tag_id uuid NOT NULL REFERENCES app.order_tags(id) ON DELETE CASCADE,
  created_by_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, order_tag_id)
);
--> statement-breakpoint
CREATE INDEX order_tag_assignments_order_idx ON app.order_tag_assignments(order_id, created_at DESC);
--> statement-breakpoint
INSERT INTO app.order_printing_status_events (
  order_id, fulfillment_group_id, from_state, to_state, source, metadata, created_at
)
SELECT order_id, id, NULL, printing_status, 'MIGRATION',
       jsonb_build_object('legacyGroupStatus', status), created_at
FROM app.order_fulfillment_groups;
--> statement-breakpoint
INSERT INTO app.order_fulfillment_status_history (
  order_id, fulfillment_group_id, from_state, to_state, source, metadata, created_at
)
SELECT order_id, id, NULL, fulfillment_status, 'MIGRATION',
       jsonb_build_object('legacyGroupStatus', status, 'evidence', 'strongest-durable'), created_at
FROM app.order_fulfillment_groups;
