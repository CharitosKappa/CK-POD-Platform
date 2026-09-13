ALTER TABLE app.orders
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL,
  ADD COLUMN amount_due_cents integer NOT NULL DEFAULT 0 CHECK (amount_due_cents >= 0),
  ADD COLUMN refundable_adjustment_cents integer NOT NULL DEFAULT 0 CHECK (refundable_adjustment_cents >= 0);
--> statement-breakpoint
CREATE INDEX orders_archived_created_idx
  ON app.orders(archived_at, created_at DESC)
  WHERE archived_at IS NOT NULL;
--> statement-breakpoint
ALTER TABLE app.order_operational_audits
  ADD COLUMN idempotency_key text
    CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 12 AND 120);
--> statement-breakpoint
CREATE UNIQUE INDEX order_operational_audits_idempotency_idx
  ON app.order_operational_audits(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE TABLE app.order_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('REQUESTED','PROCESSING','SUCCEEDED','PARTIAL','FAILED')),
  refund_destination text NOT NULL CHECK (refund_destination IN ('ORIGINAL_PAYMENT','STORE_CREDIT','LATER')),
  refund_amount_cents integer NOT NULL DEFAULT 0 CHECK (refund_amount_cents >= 0),
  reason_code text NOT NULL,
  staff_note text CHECK (staff_note IS NULL OR char_length(staff_note) <= 1000),
  notify_customer boolean NOT NULL DEFAULT true,
  initiated_by_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 12 AND 120),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (order_id, idempotency_key)
);
--> statement-breakpoint
CREATE INDEX order_cancellations_order_status_created_idx
  ON app.order_cancellations(order_id, status, created_at DESC);
--> statement-breakpoint
CREATE TABLE app.order_cancellation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_cancellation_id uuid NOT NULL REFERENCES app.order_cancellations(id) ON DELETE CASCADE,
  fulfillment_group_id uuid NOT NULL REFERENCES app.order_fulfillment_groups(id) ON DELETE RESTRICT,
  external_order_id text,
  status text NOT NULL CHECK (status IN ('NOT_REQUIRED','REQUESTED','CANCELLED','UNAVAILABLE','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_error_code text,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_attempt_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_cancellation_id, fulfillment_group_id)
);
--> statement-breakpoint
CREATE INDEX order_cancellation_groups_retry_idx
  ON app.order_cancellation_groups(updated_at)
  WHERE status IN ('UNAVAILABLE','FAILED');
--> statement-breakpoint
CREATE TABLE app.order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','CLOSED','REJECTED')),
  reason_code text NOT NULL,
  shipping_required boolean NOT NULL DEFAULT true,
  carrier text,
  tracking_number text,
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_by_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 12 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, idempotency_key)
);
--> statement-breakpoint
CREATE INDEX order_returns_order_state_created_idx
  ON app.order_returns(order_id, state, created_at DESC);
--> statement-breakpoint
CREATE TABLE app.order_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_return_id uuid NOT NULL REFERENCES app.order_returns(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES app.order_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  UNIQUE (order_return_id, order_item_id)
);
--> statement-breakpoint
CREATE TABLE app.order_return_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_return_id uuid NOT NULL REFERENCES app.order_returns(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL CHECK (to_state IN ('REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','CLOSED','REJECTED')),
  actor_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 12 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.order_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  price_difference_cents integer NOT NULL,
  reason_code text NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_by_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 12 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, idempotency_key)
);
--> statement-breakpoint
ALTER TABLE app.order_refunds
  ADD COLUMN destination text NOT NULL DEFAULT 'ORIGINAL_PAYMENT'
    CHECK (destination IN ('ORIGINAL_PAYMENT','STORE_CREDIT')),
  ADD COLUMN initiated_by_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  ADD COLUMN store_credit_ledger_entry_id uuid REFERENCES app.store_credit_ledger(id) ON DELETE RESTRICT,
  ALTER COLUMN initiated_by_user_id DROP NOT NULL,
  ALTER COLUMN provider DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app.order_refunds
  ADD CONSTRAINT order_refunds_exactly_one_actor_check CHECK (
    (initiated_by_user_id IS NOT NULL AND initiated_by_staff_member_id IS NULL)
    OR
    (initiated_by_user_id IS NULL AND initiated_by_staff_member_id IS NOT NULL)
  ),
  ADD CONSTRAINT order_refunds_destination_backing_check CHECK (
    (
      destination = 'ORIGINAL_PAYMENT'
      AND payment_id IS NOT NULL
      AND store_credit_ledger_entry_id IS NULL
    )
    OR
    (
      destination = 'STORE_CREDIT'
      AND provider IS NULL
      AND (
        (status = 'PENDING' AND store_credit_ledger_entry_id IS NULL)
        OR (status = 'SUCCEEDED' AND store_credit_ledger_entry_id IS NOT NULL)
        OR status = 'FAILED'
      )
    )
  );
