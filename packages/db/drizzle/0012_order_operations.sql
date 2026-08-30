--> statement-breakpoint
ALTER TABLE app.users DROP CONSTRAINT IF EXISTS users_role_check;
--> statement-breakpoint
ALTER TABLE app.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('CUSTOMER', 'FULFILLMENT_ADMIN', 'ADMIN', 'CX_OPS', 'PREPRESS_REVIEWER'));
--> statement-breakpoint
ALTER TABLE app.order_state_history
  ADD COLUMN actor_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  ADD COLUMN reason_code text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE TABLE app.order_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('PREPRESS', 'COMPLIANCE')),
  outcome text NOT NULL CHECK (outcome IN ('PENDING', 'APPROVED', 'HELD', 'REJECTED')),
  reason_code text,
  notes text,
  actor_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX order_reviews_order_stage_idx ON app.order_reviews(order_id, stage, created_at DESC);
--> statement-breakpoint
CREATE TABLE app.order_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  previous_state text NOT NULL,
  reason_code text NOT NULL,
  notes text,
  held_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  held_at timestamptz NOT NULL DEFAULT now(),
  resumed_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  resumed_at timestamptz,
  resume_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX order_holds_active_idx ON app.order_holds(order_id) WHERE resumed_at IS NULL;
--> statement-breakpoint
CREATE TABLE app.order_final_routing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  routing_evaluation_id uuid NOT NULL REFERENCES app.routing_evaluations(id) ON DELETE RESTRICT,
  recommended_qualification_id uuid REFERENCES app.provider_qualifications(id) ON DELETE SET NULL,
  selected_qualification_id uuid REFERENCES app.provider_qualifications(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('ROUTED', 'NO_ELIGIBLE_CANDIDATE', 'OVERRIDDEN')),
  snapshot jsonb NOT NULL,
  created_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX order_final_routing_order_idx ON app.order_final_routing(order_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE app.order_provider_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  routing_evaluation_id uuid NOT NULL REFERENCES app.routing_evaluations(id) ON DELETE RESTRICT,
  recommended_qualification_id uuid REFERENCES app.provider_qualifications(id) ON DELETE SET NULL,
  selected_qualification_id uuid NOT NULL REFERENCES app.provider_qualifications(id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  notes text,
  actor_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.order_readiness_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  ready boolean NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX order_readiness_order_idx ON app.order_readiness_evaluations(order_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE app.external_fulfillment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES app.orders(id) ON DELETE RESTRICT,
  adapter_type text NOT NULL CHECK (adapter_type IN ('PRINTIFY')),
  qualification_id uuid NOT NULL REFERENCES app.provider_qualifications(id) ON DELETE RESTRICT,
  provider_derivative_id uuid NOT NULL REFERENCES app.provider_derivatives(id) ON DELETE RESTRICT,
  external_order_id text NOT NULL UNIQUE,
  submission_state text NOT NULL DEFAULT 'CREATED' CHECK (submission_state IN ('CREATED', 'SUBMITTED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED')),
  provider_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.order_fulfillment_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('CREATE_EXTERNAL_ORDER', 'SUBMIT_TO_PRODUCTION', 'SYNC_STATUS')),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRYING', 'FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  external_order_id text,
  failure_code text,
  failure_detail text,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (order_id, action)
);
--> statement-breakpoint
CREATE TABLE app.order_fulfillment_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  external_event_id text,
  source text NOT NULL CHECK (source IN ('WEBHOOK', 'POLLING')),
  raw_status text NOT NULL,
  normalized_status text,
  disposition text NOT NULL CHECK (disposition IN ('APPLIED', 'DUPLICATE', 'CONFLICT', 'UNKNOWN')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, external_event_id)
);
--> statement-breakpoint
CREATE TABLE app.order_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  external_order_id text,
  carrier text,
  service text,
  tracking_number text,
  tracking_url text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  status text NOT NULL DEFAULT 'PENDING',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, tracking_number)
);
--> statement-breakpoint
CREATE TABLE app.order_operational_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  action text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('SYSTEM', 'OPS', 'WEBHOOK', 'POLLING')),
  actor_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  reason_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX order_operational_audits_order_idx ON app.order_operational_audits(order_id, created_at DESC);
