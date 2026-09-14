ALTER TABLE app.order_edit_payment_attempts
  ADD COLUMN request_snapshot jsonb,
  ADD COLUMN provider_submission_started_at timestamptz;
--> statement-breakpoint
UPDATE app.order_edit_payment_attempts attempt
SET request_snapshot=jsonb_build_object(
  'reference',jsonb_build_object(
    'kind','ORDER_EDIT',
    'orderId',attempt.order_id,
    'orderRevisionId',attempt.order_revision_id,
    'orderEditPaymentAttemptId',attempt.id
  ),
  'amountCents',attempt.amount_cents,
  'currency',attempt.currency,
  'idempotencyKey',attempt.idempotency_key,
  'customerEmail',orders.customer_email,
  'billingAddress',CASE WHEN orders.billing_address_snapshot='{}'::jsonb
    THEN orders.shipping_address_snapshot ELSE orders.billing_address_snapshot END
)
FROM app.orders orders WHERE orders.id=attempt.order_id;
--> statement-breakpoint
ALTER TABLE app.order_edit_payment_attempts
  ALTER COLUMN request_snapshot SET NOT NULL;
--> statement-breakpoint
DO $$
DECLARE backing_constraint text;
BEGIN
  SELECT constraint_row.conname INTO backing_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid='app.order_edit_payment_attempts'::regclass
    AND constraint_row.contype='c'
    AND pg_get_constraintdef(constraint_row.oid) LIKE '%status <> %PREPARING%'
  LIMIT 1;
  IF backing_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE app.order_edit_payment_attempts DROP CONSTRAINT %I',
      backing_constraint
    );
  END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE app.order_edit_payment_attempts
  ADD CONSTRAINT order_edit_payment_attempts_provider_backing_check CHECK (
    (status='PREPARING' AND provider IS NULL AND provider_payment_id IS NULL)
    OR (status='FAILED' AND provider IS NULL AND provider_payment_id IS NULL)
    OR (status<>'PREPARING' AND provider IS NOT NULL AND provider_payment_id IS NOT NULL)
  );
--> statement-breakpoint
UPDATE app.order_edit_payment_attempts SET status='PENDING' WHERE status='FAILED';
--> statement-breakpoint
DROP INDEX app.order_edit_payment_attempts_one_active_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX order_edit_payment_attempts_one_active_idx
  ON app.order_edit_payment_attempts(order_id)
  WHERE status IN ('PREPARING','PENDING') OR (status='FAILED' AND provider_payment_id IS NOT NULL);
--> statement-breakpoint
CREATE FUNCTION app.reject_order_edit_payment_request_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.request_snapshot IS DISTINCT FROM NEW.request_snapshot THEN
    RAISE EXCEPTION 'order edit payment request snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_edit_payment_request_immutable
BEFORE UPDATE ON app.order_edit_payment_attempts
FOR EACH ROW EXECUTE FUNCTION app.reject_order_edit_payment_request_mutation();
--> statement-breakpoint
CREATE TABLE app.order_payment_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  order_edit_payment_attempt_id uuid NOT NULL UNIQUE
    REFERENCES app.order_edit_payment_attempts(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('FAKE','STRIPE')),
  provider_payment_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  request_snapshot jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider,provider_payment_id)
);
--> statement-breakpoint
CREATE INDEX order_payment_captures_order_idx
  ON app.order_payment_captures(order_id,captured_at,id);
--> statement-breakpoint
CREATE FUNCTION app.reject_order_payment_capture_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order payment captures are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_payment_captures_immutable
BEFORE UPDATE OR DELETE ON app.order_payment_captures
FOR EACH ROW EXECUTE FUNCTION app.reject_order_payment_capture_mutation();
--> statement-breakpoint
CREATE TABLE app.order_refund_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_refund_id uuid NOT NULL REFERENCES app.order_refunds(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  checkout_payment_id uuid REFERENCES app.payments(id) ON DELETE RESTRICT,
  order_payment_capture_id uuid REFERENCES app.order_payment_captures(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('FAKE','STRIPE')),
  provider_payment_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  status text NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
  provider_refund_id text UNIQUE,
  -- Legacy USER/CX keys predate the staff API's minimum length validation.
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((checkout_payment_id IS NULL) <> (order_payment_capture_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX order_refund_allocations_order_refund_idx
  ON app.order_refund_allocations(order_refund_id,id);
--> statement-breakpoint
INSERT INTO app.order_refund_allocations
  (order_refund_id,order_id,checkout_payment_id,provider,provider_payment_id,
   amount_cents,currency,status,provider_refund_id,idempotency_key,created_at,completed_at)
SELECT refund.id,refund.order_id,refund.payment_id,payment.provider,payment.provider_payment_id,
       refund.amount_cents,payment.currency,refund.status,refund.provider_refund_id,
       refund.idempotency_key || ':capture:1',refund.created_at,refund.completed_at
FROM app.order_refunds refund
JOIN app.payments payment ON payment.id=refund.payment_id
WHERE refund.destination='ORIGINAL_PAYMENT';
