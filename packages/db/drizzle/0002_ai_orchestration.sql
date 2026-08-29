--> statement-breakpoint
CREATE TABLE app.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
  generation_id uuid,
  asset_type text NOT NULL CHECK (asset_type IN ('REFERENCE', 'SOURCE_OUTPUT', 'PREVIEW')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REJECTED', 'DELETED')),
  storage_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  width integer,
  height integer,
  source_asset_id uuid REFERENCES app.assets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX assets_project_idx ON app.assets(project_id);
--> statement-breakpoint
CREATE INDEX assets_generation_idx ON app.assets(generation_id);
--> statement-breakpoint
CREATE TABLE app.credit_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('GUEST', 'USER')),
  owner_session_id uuid REFERENCES app.sessions(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES app.users(id) ON DELETE CASCADE,
  current_balance integer NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (owner_type = 'GUEST' AND owner_session_id IS NOT NULL AND owner_user_id IS NULL)
    OR (owner_type = 'USER' AND owner_user_id IS NOT NULL AND owner_session_id IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX credit_accounts_guest_owner_idx
  ON app.credit_accounts(owner_session_id) WHERE owner_type = 'GUEST';
--> statement-breakpoint
CREATE UNIQUE INDEX credit_accounts_user_owner_idx
  ON app.credit_accounts(owner_user_id) WHERE owner_type = 'USER';
--> statement-breakpoint
CREATE TABLE app.generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
  requested_by_session_id uuid REFERENCES app.sessions(id) ON DELETE SET NULL,
  requested_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN (
    'QUEUED', 'PROCESSING', 'VALIDATING', 'SUCCEEDED', 'FAILED', 'REJECTED_INTERNAL', 'CANCELLED'
  )),
  raw_prompt text NOT NULL,
  enhanced_prompt text NOT NULL,
  prompt_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  style_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  product_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  reference_asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_asset_id uuid REFERENCES app.assets(id) ON DELETE SET NULL,
  delivered_asset_id uuid REFERENCES app.assets(id) ON DELETE SET NULL,
  credit_account_id uuid REFERENCES app.credit_accounts(id) ON DELETE SET NULL,
  credit_status text NOT NULL DEFAULT 'PENDING' CHECK (credit_status IN ('PENDING', 'CONSUMED', 'NOT_CONSUMED', 'REFUNDED')),
  queue_job_id text,
  failure_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX generations_project_idx ON app.generations(project_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX generations_status_idx ON app.generations(status, created_at);
--> statement-breakpoint
ALTER TABLE app.assets
  ADD CONSTRAINT assets_generation_fk
  FOREIGN KEY (generation_id) REFERENCES app.generations(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE app.generation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES app.generations(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  model_identifier text NOT NULL,
  task text NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED')),
  latency_ms integer,
  estimated_cost_cents integer,
  actual_cost_cents integer,
  provider_request_id text,
  failure_category text,
  failure_detail text,
  input_width integer,
  input_height integer,
  output_width integer,
  output_height integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (generation_id, attempt_number)
);
--> statement-breakpoint
CREATE INDEX generation_attempts_generation_idx ON app.generation_attempts(generation_id, attempt_number);
--> statement-breakpoint
CREATE TABLE app.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_account_id uuid NOT NULL REFERENCES app.credit_accounts(id) ON DELETE CASCADE,
  generation_id uuid REFERENCES app.generations(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('GRANT', 'PURCHASE', 'CONSUME', 'REFUND', 'ADJUSTMENT', 'EXPIRATION')),
  amount integer NOT NULL CHECK (amount <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX credit_ledger_account_idx ON app.credit_ledger(credit_account_id, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX credit_ledger_generation_consume_idx
  ON app.credit_ledger(generation_id, entry_type) WHERE entry_type = 'CONSUME';
