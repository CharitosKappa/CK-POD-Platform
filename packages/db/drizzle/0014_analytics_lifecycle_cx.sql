--> statement-breakpoint
ALTER TABLE app.analytics_events ADD COLUMN IF NOT EXISTS idempotency_key text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_idempotency_idx
  ON app.analytics_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
ALTER TABLE app.analytics_events DROP CONSTRAINT IF EXISTS analytics_events_event_name_check;
--> statement-breakpoint
ALTER TABLE app.analytics_events ADD CONSTRAINT analytics_events_event_name_check CHECK (event_name IN (
  'session_started', 'product_viewed', 'product_selected', 'color_selected', 'prompt_submitted',
  'generation_started', 'generation_succeeded', 'generation_rejected_internal', 'generation_failed', 'regeneration_started',
  'editor_opened', 'editor_action', 'design_saved', 'proof_approved', 'add_to_cart', 'checkout_started',
  'payment_succeeded', 'payment_failed', 'shipping_option_selected', 'tax_calculated', 'order_created',
  'order_approved', 'order_submitted', 'order_shipped', 'order_delivered', 'refund', 'reprint',
  'moderation_started', 'moderation_allowed', 'moderation_blocked', 'moderation_review_required', 'moderation_unknown'
));
--> statement-breakpoint
CREATE TABLE app.order_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES app.payments(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('FAKE', 'STRIPE')),
  provider_refund_id text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  notes text,
  initiated_by_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
--> statement-breakpoint
CREATE TABLE app.order_reprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  original_order_item_id uuid NOT NULL REFERENCES app.order_items(id) ON DELETE RESTRICT,
  original_external_order_id uuid REFERENCES app.external_fulfillment_orders(id) ON DELETE SET NULL,
  reason_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUBMITTED')),
  estimated_cost_cents integer,
  notes text,
  created_by_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  approved_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  replacement_external_order_id uuid REFERENCES app.external_fulfillment_orders(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE app.provider_defects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  reprint_id uuid REFERENCES app.order_reprints(id) ON DELETE SET NULL,
  provider_id text REFERENCES app.print_providers(id) ON DELETE SET NULL,
  defect_code text NOT NULL,
  notes text,
  recorded_by_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES app.orders(id) ON DELETE SET NULL,
  customer_email text NOT NULL,
  body text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.lifecycle_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('EMAIL')),
  classification text NOT NULL CHECK (classification IN ('TRANSACTIONAL', 'MARKETING')),
  recipient_email text NOT NULL,
  order_id uuid REFERENCES app.orders(id) ON DELETE SET NULL,
  project_id uuid REFERENCES app.projects(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  provider text NOT NULL CHECK (provider IN ('FAKE', 'KLAVIYO')),
  status text NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'RETRYING', 'SUPPRESSED', 'CANCELLED')),
  provider_message_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
