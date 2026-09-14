ALTER TABLE app.order_revisions
  ADD CONSTRAINT order_revisions_id_order_unique UNIQUE (id, order_id);
--> statement-breakpoint
CREATE TABLE app.order_edit_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  order_revision_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('PREPARING','PENDING','SUCCEEDED','FAILED','CANCELLED')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  provider text CHECK (provider IN ('FAKE','STRIPE')),
  provider_payment_id text,
  provider_client_secret text,
  provider_status text,
  initiated_by_staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 12 AND 120),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (provider, provider_payment_id),
  FOREIGN KEY (order_revision_id, order_id)
    REFERENCES app.order_revisions(id, order_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'PREPARING' AND provider IS NULL AND provider_payment_id IS NULL)
    OR
    (status <> 'PREPARING' AND provider IS NOT NULL AND provider_payment_id IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX order_edit_payment_attempts_one_active_idx
  ON app.order_edit_payment_attempts(order_id)
  WHERE status IN ('PREPARING','PENDING');
--> statement-breakpoint
CREATE INDEX order_edit_payment_attempts_order_created_idx
  ON app.order_edit_payment_attempts(order_id, created_at DESC);
