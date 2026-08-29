--> statement-breakpoint
ALTER TABLE app.users
  ADD COLUMN role text NOT NULL DEFAULT 'CUSTOMER'
  CHECK (role IN ('CUSTOMER', 'FULFILLMENT_ADMIN'));
--> statement-breakpoint
CREATE TABLE app.print_providers (
  id text PRIMARY KEY,
  adapter_type text NOT NULL CHECK (adapter_type IN ('PRINTIFY')),
  external_id text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ENABLED' CHECK (status IN ('ENABLED', 'SUSPENDED', 'DISABLED')),
  development_only boolean NOT NULL DEFAULT true,
  external_available boolean NOT NULL DEFAULT true,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (adapter_type, external_id)
);
--> statement-breakpoint
CREATE TABLE app.fulfillment_product_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_model_id text NOT NULL REFERENCES app.product_models(id) ON DELETE RESTRICT,
  adapter_type text NOT NULL CHECK (adapter_type IN ('PRINTIFY')),
  external_blueprint_id text NOT NULL,
  allowlisted boolean NOT NULL DEFAULT true,
  external_available boolean NOT NULL DEFAULT true,
  external_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_model_id, adapter_type),
  UNIQUE (adapter_type, external_blueprint_id)
);
--> statement-breakpoint
CREATE TABLE app.fulfillment_variant_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_variant_id text NOT NULL REFERENCES app.product_variants(id) ON DELETE RESTRICT,
  adapter_type text NOT NULL CHECK (adapter_type IN ('PRINTIFY')),
  external_variant_id text NOT NULL,
  external_available boolean NOT NULL DEFAULT true,
  external_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_variant_id, adapter_type),
  UNIQUE (adapter_type, external_variant_id)
);
--> statement-breakpoint
CREATE TABLE app.provider_variants (
  provider_id text NOT NULL REFERENCES app.print_providers(id) ON DELETE RESTRICT,
  product_variant_id text NOT NULL REFERENCES app.product_variants(id) ON DELETE RESTRICT,
  external_variant_id text NOT NULL,
  available boolean NOT NULL DEFAULT true,
  external_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  PRIMARY KEY (provider_id, product_variant_id)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.qualification_requires_validation(
  candidate_status text,
  candidate_g3_reviewed boolean,
  candidate_physical_test_status text
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT candidate_status = 'QUALIFIED'
    AND (NOT candidate_g3_reviewed OR candidate_physical_test_status <> 'PASSED');
$$;
--> statement-breakpoint
CREATE TABLE app.provider_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_model_id text NOT NULL REFERENCES app.product_models(id) ON DELETE RESTRICT,
  provider_id text NOT NULL REFERENCES app.print_providers(id) ON DELETE RESTRICT,
  decoration_method text NOT NULL,
  qualification_status text NOT NULL CHECK (qualification_status IN ('UNQUALIFIED', 'UNDER_REVIEW', 'QUALIFIED', 'SUSPENDED', 'REJECTED')),
  active boolean NOT NULL DEFAULT true,
  technical_compatible boolean NOT NULL DEFAULT false,
  g3_reviewed boolean NOT NULL DEFAULT false,
  physical_test_status text NOT NULL DEFAULT 'NOT_TESTED' CHECK (physical_test_status IN ('NOT_TESTED', 'PENDING', 'PASSED', 'FAILED')),
  reliability_score integer NOT NULL DEFAULT 0 CHECK (reliability_score BETWEEN 0 AND 100),
  reliability_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  destination_countries jsonb NOT NULL DEFAULT '[]'::jsonb,
  shipping_enabled boolean NOT NULL DEFAULT false,
  routing_notes text,
  qualification_notes text,
  qualified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_model_id, provider_id, decoration_method),
  CHECK (NOT app.qualification_requires_validation(qualification_status, g3_reviewed, physical_test_status))
);
--> statement-breakpoint
CREATE TABLE app.provider_profile_mappings (
  qualification_id uuid PRIMARY KEY REFERENCES app.provider_qualifications(id) ON DELETE RESTRICT,
  production_profile_id text NOT NULL REFERENCES app.production_profiles(id) ON DELETE RESTRICT,
  derivative_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.provider_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_id uuid NOT NULL REFERENCES app.provider_qualifications(id) ON DELETE RESTRICT,
  base_production_cents integer NOT NULL DEFAULT 0 CHECK (base_production_cents >= 0),
  variant_cents integer NOT NULL DEFAULT 0 CHECK (variant_cents >= 0),
  decoration_cents integer NOT NULL DEFAULT 0 CHECK (decoration_cents >= 0),
  provider_fee_cents integer NOT NULL DEFAULT 0 CHECK (provider_fee_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  is_current boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'DEVELOPMENT',
  captured_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX provider_costs_current_idx ON app.provider_costs(qualification_id) WHERE is_current;
--> statement-breakpoint
CREATE TABLE app.shipping_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL REFERENCES app.print_providers(id) ON DELETE RESTRICT,
  qualification_id uuid REFERENCES app.provider_qualifications(id) ON DELETE SET NULL,
  destination_country text NOT NULL,
  method text NOT NULL,
  shipping_cents integer NOT NULL CHECK (shipping_cents >= 0),
  currency text NOT NULL,
  estimated_delivery_min_days integer CHECK (estimated_delivery_min_days >= 0),
  estimated_delivery_max_days integer CHECK (estimated_delivery_max_days >= 0),
  estimate_kind text NOT NULL CHECK (estimate_kind IN ('ESTIMATE', 'PROVIDER_SLA', 'UNKNOWN')),
  quoted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  source text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX shipping_quotes_lookup_idx ON app.shipping_quotes(provider_id, destination_country, quoted_at DESC);
--> statement-breakpoint
CREATE TABLE app.catalog_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter_type text NOT NULL CHECK (adapter_type IN ('PRINTIFY')),
  status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  idempotency_key text NOT NULL UNIQUE,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_category text,
  failure_detail text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.routing_configurations (
  id text PRIMARY KEY,
  version integer NOT NULL CHECK (version > 0),
  active boolean NOT NULL DEFAULT true,
  configuration jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, version)
);
--> statement-breakpoint
CREATE UNIQUE INDEX routing_configurations_active_idx ON app.routing_configurations(active) WHERE active;
--> statement-breakpoint
CREATE TABLE app.routing_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES app.projects(id) ON DELETE SET NULL,
  prepress_run_id uuid REFERENCES app.prepress_runs(id) ON DELETE SET NULL,
  product_model_id text NOT NULL REFERENCES app.product_models(id) ON DELETE RESTRICT,
  product_variant_id text NOT NULL REFERENCES app.product_variants(id) ON DELETE RESTRICT,
  destination_country text NOT NULL,
  retail_price_cents integer NOT NULL CHECK (retail_price_cents >= 0),
  routing_configuration_id text NOT NULL REFERENCES app.routing_configurations(id) ON DELETE RESTRICT,
  routing_configuration_version integer NOT NULL,
  selected_qualification_id uuid REFERENCES app.provider_qualifications(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('ROUTED', 'NO_ELIGIBLE_CANDIDATE')),
  request_snapshot jsonb NOT NULL,
  decision_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX routing_evaluations_product_idx ON app.routing_evaluations(product_model_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE app.provider_derivatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prepress_run_id uuid NOT NULL REFERENCES app.prepress_runs(id) ON DELETE RESTRICT,
  qualification_id uuid NOT NULL REFERENCES app.provider_qualifications(id) ON DELETE RESTRICT,
  production_master_asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE RESTRICT,
  derivative_asset_id uuid REFERENCES app.assets(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'READY', 'REVIEW_REQUIRED', 'FAILED')),
  requirement_snapshot jsonb NOT NULL,
  failure_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
--> statement-breakpoint
CREATE TABLE app.fulfillment_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter_type text NOT NULL CHECK (adapter_type IN ('PRINTIFY')),
  operation text NOT NULL CHECK (operation IN ('CREATE_ORDER', 'SUBMIT_PRODUCTION')),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  external_reference text,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
--> statement-breakpoint
CREATE TABLE app.fulfillment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter_type text NOT NULL CHECK (adapter_type IN ('PRINTIFY')),
  external_event_id text,
  event_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('RECEIVED', 'PROCESSED', 'UNKNOWN', 'REJECTED')),
  provider_id text REFERENCES app.print_providers(id) ON DELETE SET NULL,
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (adapter_type, external_event_id)
);
--> statement-breakpoint
CREATE TABLE app.fulfillment_operational_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL CHECK (event_name IN (
    'catalog_sync_started', 'catalog_sync_succeeded', 'catalog_sync_failed',
    'provider_candidate_evaluated', 'provider_candidate_excluded', 'routing_completed',
    'routing_failed', 'shipping_quote_received', 'provider_status_changed'
  )),
  product_model_id text REFERENCES app.product_models(id) ON DELETE SET NULL,
  provider_id text REFERENCES app.print_providers(id) ON DELETE SET NULL,
  routing_evaluation_id uuid REFERENCES app.routing_evaluations(id) ON DELETE SET NULL,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO app.fulfillment_product_mappings (product_model_id, adapter_type, external_blueprint_id, external_metadata)
VALUES ('essential-dtg-tee', 'PRINTIFY', 'fake-essential-dtg-tee-blueprint', '{"catalog":"development-fake"}'::jsonb)
ON CONFLICT (product_model_id, adapter_type) DO NOTHING;
--> statement-breakpoint
INSERT INTO app.fulfillment_variant_mappings (product_variant_id, adapter_type, external_variant_id, external_metadata)
SELECT id, 'PRINTIFY', 'fake-' || id, '{"catalog":"development-fake"}'::jsonb
FROM app.product_variants WHERE product_model_id = 'essential-dtg-tee'
ON CONFLICT (product_variant_id, adapter_type) DO NOTHING;
--> statement-breakpoint
INSERT INTO app.print_providers (id, adapter_type, external_id, display_name, status, development_only, capabilities)
VALUES
  ('printify-fake-harbor', 'PRINTIFY', 'fake-harbor', 'Harbor Print Co. (development)', 'ENABLED', true, '{"decorationMethods":["DTG"]}'::jsonb),
  ('printify-fake-summit', 'PRINTIFY', 'fake-summit', 'Summit Apparel (development)', 'ENABLED', true, '{"decorationMethods":["DTG"]}'::jsonb),
  ('printify-fake-atlas', 'PRINTIFY', 'fake-atlas', 'Atlas Print Lab (development)', 'SUSPENDED', true, '{"decorationMethods":["DTG"]}'::jsonb)
ON CONFLICT (adapter_type, external_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO app.provider_qualifications (
  product_model_id, provider_id, decoration_method, qualification_status, active, technical_compatible,
  g3_reviewed, physical_test_status, reliability_score, destination_countries, shipping_enabled, qualification_notes
) VALUES
  ('essential-dtg-tee', 'printify-fake-harbor', 'DTG', 'UNQUALIFIED', true, true, false, 'NOT_TESTED', 0, '["US"]'::jsonb, true, 'Development mapping only; G3 and G6 evidence is required.'),
  ('essential-dtg-tee', 'printify-fake-summit', 'DTG', 'UNQUALIFIED', true, true, false, 'NOT_TESTED', 0, '["US","CA"]'::jsonb, true, 'Development mapping only; G3 and G6 evidence is required.'),
  ('essential-dtg-tee', 'printify-fake-atlas', 'DTG', 'SUSPENDED', false, true, false, 'NOT_TESTED', 0, '["US"]'::jsonb, false, 'Development mapping only; provider is deliberately suspended.')
ON CONFLICT (product_model_id, provider_id, decoration_method) DO NOTHING;
--> statement-breakpoint
INSERT INTO app.routing_configurations (id, version, configuration)
VALUES (
  'm5-development-routing-v1',
  1,
  '{"minimumContributionCents":500,"maximumLandedCostCents":2600,"weights":{"compatibility":1000,"availability":500,"reliability":100,"delivery":10,"landedCost":1},"printifyOrderRoutingFallbackEnabled":false}'::jsonb
) ON CONFLICT (id) DO NOTHING;
