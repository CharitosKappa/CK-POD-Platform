--> statement-breakpoint
CREATE TABLE app.mockups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
  project_version_id uuid NOT NULL REFERENCES app.project_versions(id) ON DELETE RESTRICT,
  prepress_run_id uuid NOT NULL REFERENCES app.prepress_runs(id) ON DELETE RESTRICT,
  product_model_id text NOT NULL REFERENCES app.product_models(id) ON DELETE RESTRICT,
  color_code text NOT NULL,
  preview_asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE RESTRICT,
  renderer text NOT NULL,
  renderer_version text NOT NULL,
  state_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_version_id, prepress_run_id, renderer, renderer_version)
);
--> statement-breakpoint
CREATE INDEX mockups_project_version_idx ON app.mockups(project_id, project_version_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE app.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('GUEST', 'USER')),
  owner_session_id uuid REFERENCES app.sessions(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES app.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY', 'CHECKOUT_CREATED', 'COMPLETED', 'ABANDONED')),
  currency text NOT NULL DEFAULT 'USD',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_type = 'GUEST' AND owner_session_id IS NOT NULL AND owner_user_id IS NULL) OR
         (owner_type = 'USER' AND owner_user_id IS NOT NULL AND owner_session_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX carts_guest_owner_idx ON app.carts(owner_session_id) WHERE owner_type = 'GUEST';
--> statement-breakpoint
CREATE INDEX carts_user_owner_idx ON app.carts(owner_user_id) WHERE owner_type = 'USER';
--> statement-breakpoint
CREATE TABLE app.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES app.carts(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES app.projects(id) ON DELETE RESTRICT,
  project_version_id uuid NOT NULL REFERENCES app.project_versions(id) ON DELETE RESTRICT,
  prepress_run_id uuid NOT NULL REFERENCES app.prepress_runs(id) ON DELETE RESTRICT,
  mockup_id uuid NOT NULL REFERENCES app.mockups(id) ON DELETE RESTRICT,
  product_model_id text NOT NULL REFERENCES app.product_models(id) ON DELETE RESTRICT,
  product_variant_id text NOT NULL REFERENCES app.product_variants(id) ON DELETE RESTRICT,
  color_code text NOT NULL,
  size text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= 99),
  product_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX cart_items_cart_idx ON app.cart_items(cart_id, created_at);
--> statement-breakpoint
CREATE TABLE app.proof_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_item_id uuid NOT NULL REFERENCES app.cart_items(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES app.projects(id) ON DELETE RESTRICT,
  project_version_id uuid NOT NULL REFERENCES app.project_versions(id) ON DELETE RESTRICT,
  prepress_run_id uuid NOT NULL REFERENCES app.prepress_runs(id) ON DELETE RESTRICT,
  mockup_id uuid NOT NULL REFERENCES app.mockups(id) ON DELETE RESTRICT,
  product_model_id text NOT NULL REFERENCES app.product_models(id) ON DELETE RESTRICT,
  color_code text NOT NULL,
  approval_state text NOT NULL CHECK (approval_state IN ('APPROVED', 'INVALIDATED')),
  state_hash text NOT NULL,
  approved_by_session_id uuid REFERENCES app.sessions(id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  invalidation_reason text
);
--> statement-breakpoint
CREATE INDEX proof_approvals_item_state_idx ON app.proof_approvals(cart_item_id, approval_state, approved_at DESC);
--> statement-breakpoint
CREATE TABLE app.shipping_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES app.carts(id) ON DELETE CASCADE,
  recipient_name text NOT NULL,
  email text NOT NULL,
  phone text,
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  state_code text NOT NULL,
  postal_code text NOT NULL,
  country_code text NOT NULL DEFAULT 'US',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES app.carts(id) ON DELETE RESTRICT,
  shipping_address_id uuid NOT NULL REFERENCES app.shipping_addresses(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('READY', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAID', 'EXPIRED')),
  idempotency_key text NOT NULL UNIQUE,
  currency text NOT NULL DEFAULT 'USD',
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  pricing_snapshot jsonb NOT NULL,
  shipping_snapshot jsonb NOT NULL,
  tax_snapshot jsonb NOT NULL,
  provisional_shipping_source text NOT NULL DEFAULT 'FULFILLMENT_ESTIMATE',
  payment_provider text NOT NULL CHECK (payment_provider IN ('FAKE', 'STRIPE')),
  provider_payment_id text,
  provider_client_secret text,
  price_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_provider, provider_payment_id)
);
--> statement-breakpoint
CREATE INDEX checkout_attempts_cart_idx ON app.checkout_attempts(cart_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE app.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_attempt_id uuid NOT NULL UNIQUE REFERENCES app.checkout_attempts(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('FAKE', 'STRIPE')),
  provider_payment_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL,
  provider_fee_cents integer,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);
--> statement-breakpoint
CREATE TABLE app.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('FAKE', 'STRIPE')),
  provider_event_id text NOT NULL,
  event_name text NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN ('VERIFIED', 'REJECTED', 'UNKNOWN')),
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, provider_event_id)
);
--> statement-breakpoint
CREATE TABLE app.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  cart_id uuid NOT NULL UNIQUE REFERENCES app.carts(id) ON DELETE RESTRICT,
  checkout_attempt_id uuid NOT NULL UNIQUE REFERENCES app.checkout_attempts(id) ON DELETE RESTRICT,
  owner_type text NOT NULL CHECK (owner_type IN ('GUEST', 'USER')),
  owner_session_id uuid REFERENCES app.sessions(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  customer_email text NOT NULL,
  shipping_address_snapshot jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PAYMENT_PENDING', 'PAID', 'PREPRESS_REVIEW', 'COMPLIANCE_REVIEW', 'ROUTING', 'READY_FOR_PRODUCTION', 'SUBMITTED_TO_PRINTIFY', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED', 'ON_HOLD', 'FAILED', 'CANCELLED', 'REPRINT_REQUIRED', 'REFUND_REQUIRED')),
  pricing_snapshot jsonb NOT NULL,
  financial_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE CASCADE,
  cart_item_id uuid NOT NULL REFERENCES app.cart_items(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.projects(id) ON DELETE RESTRICT,
  project_version_id uuid NOT NULL REFERENCES app.project_versions(id) ON DELETE RESTRICT,
  prepress_run_id uuid NOT NULL REFERENCES app.prepress_runs(id) ON DELETE RESTRICT,
  mockup_id uuid NOT NULL REFERENCES app.mockups(id) ON DELETE RESTRICT,
  product_model_id text NOT NULL REFERENCES app.product_models(id) ON DELETE RESTRICT,
  product_variant_id text NOT NULL REFERENCES app.product_variants(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  item_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.order_state_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES app.orders(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  reason text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('SYSTEM', 'CUSTOMER', 'OPS')),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX orders_guest_owner_idx ON app.orders(owner_session_id) WHERE owner_type = 'GUEST';
--> statement-breakpoint
CREATE INDEX orders_user_owner_idx ON app.orders(owner_user_id) WHERE owner_type = 'USER';
