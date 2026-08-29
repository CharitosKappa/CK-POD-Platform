--> statement-breakpoint
ALTER TABLE app.assets DROP CONSTRAINT assets_asset_type_check;
--> statement-breakpoint
ALTER TABLE app.assets
  ADD CONSTRAINT assets_asset_type_check
  CHECK (asset_type IN (
    'REFERENCE', 'SOURCE_OUTPUT', 'PREVIEW', 'PRODUCTION_MASTER', 'PREPRESS_PREVIEW', 'PROVIDER_DERIVATIVE'
  ));
--> statement-breakpoint
CREATE TABLE app.production_profiles (
  id text PRIMARY KEY,
  product_model_id text NOT NULL REFERENCES app.product_models(id) ON DELETE RESTRICT,
  provider_id text,
  decoration_method text NOT NULL,
  qualification_status text NOT NULL CHECK (qualification_status IN ('UNQUALIFIED', 'CANDIDATE', 'TESTING', 'APPROVED', 'DEGRADED', 'DISABLED')),
  profile_data jsonb NOT NULL,
  development_only boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_model_id, provider_id, decoration_method, id)
);
--> statement-breakpoint
CREATE INDEX production_profiles_product_qualification_idx
  ON app.production_profiles(product_model_id, qualification_status);
--> statement-breakpoint
CREATE TABLE app.prepress_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
  project_version_id uuid NOT NULL REFERENCES app.project_versions(id) ON DELETE RESTRICT,
  production_profile_id text NOT NULL REFERENCES app.production_profiles(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('PENDING', 'RENDERING', 'VALIDATING', 'PASSED', 'REVIEW_REQUIRED', 'BLOCKED', 'FAILED')),
  renderer_version text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  queue_job_id text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  production_master_asset_id uuid REFERENCES app.assets(id) ON DELETE SET NULL,
  preview_asset_id uuid REFERENCES app.assets(id) ON DELETE SET NULL,
  score jsonb,
  source_asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX prepress_runs_project_version_idx ON app.prepress_runs(project_id, project_version_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX prepress_runs_status_idx ON app.prepress_runs(status, created_at);
--> statement-breakpoint
CREATE TABLE app.prepress_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prepress_run_id uuid NOT NULL REFERENCES app.prepress_runs(id) ON DELETE CASCADE,
  category text NOT NULL,
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'BLOCKER')),
  affected_layer_id text,
  message text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX prepress_findings_run_idx ON app.prepress_findings(prepress_run_id, severity);
--> statement-breakpoint
CREATE TABLE app.asset_lineage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  derived_asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE CASCADE,
  source_asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE RESTRICT,
  relationship text NOT NULL CHECK (relationship IN ('PRODUCTION_RENDER_SOURCE', 'PROVIDER_DERIVATIVE_SOURCE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (derived_asset_id, source_asset_id, relationship)
);
--> statement-breakpoint
INSERT INTO app.production_profiles (
  id, product_model_id, provider_id, decoration_method, qualification_status, profile_data, development_only
) VALUES (
  'development-essential-dtg-front-v1',
  'essential-dtg-tee',
  NULL,
  'DTG',
  'UNQUALIFIED',
  '{"physicalWidthInches":12,"physicalHeightInches":16,"targetWidthPx":3600,"targetHeightPx":4800,"targetDpi":300,"dpiWarningThreshold":200,"dpiBlockThreshold":120,"safeBounds":{"x":0.056,"y":0.078,"width":0.888,"height":0.844},"allowedFormats":["png"],"requiresTransparency":true}'::jsonb,
  true
) ON CONFLICT (id) DO NOTHING;
