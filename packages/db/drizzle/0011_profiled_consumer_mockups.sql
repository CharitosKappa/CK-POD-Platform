--> statement-breakpoint
ALTER TABLE app.assets DROP CONSTRAINT assets_asset_type_check;
--> statement-breakpoint
ALTER TABLE app.assets
  ADD CONSTRAINT assets_asset_type_check
  CHECK (asset_type IN (
    'REFERENCE', 'SOURCE_OUTPUT', 'PREVIEW', 'PRODUCTION_MASTER', 'PREPRESS_PREVIEW', 'PROVIDER_DERIVATIVE', 'MOCKUP_PROOF'
  ));
--> statement-breakpoint
ALTER TABLE app.asset_lineage DROP CONSTRAINT asset_lineage_relationship_check;
--> statement-breakpoint
ALTER TABLE app.asset_lineage
  ADD CONSTRAINT asset_lineage_relationship_check
  CHECK (relationship IN ('PRODUCTION_RENDER_SOURCE', 'PROVIDER_DERIVATIVE_SOURCE', 'MOCKUP_ARTWORK_SOURCE'));
--> statement-breakpoint
CREATE TABLE app.garment_mockup_profiles (
  id text PRIMARY KEY,
  product_model_id text NOT NULL REFERENCES app.product_models(id) ON DELETE RESTRICT,
  color_code text NOT NULL,
  version text NOT NULL,
  renderer_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  qualification text NOT NULL CHECK (qualification IN ('DEVELOPMENT / UNQUALIFIED', 'QUALIFIED')),
  profile_data jsonb NOT NULL,
  development_only boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_model_id, color_code, version)
);
--> statement-breakpoint
ALTER TABLE app.mockups
  ADD COLUMN garment_profile_id text REFERENCES app.garment_mockup_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN garment_profile_version text,
  ADD COLUMN profile_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE app.mockups DROP CONSTRAINT mockups_project_version_id_prepress_run_id_renderer_rendere_key;
--> statement-breakpoint
ALTER TABLE app.mockups
  ADD CONSTRAINT mockups_profiled_renderer_key
  UNIQUE (project_version_id, prepress_run_id, product_model_id, color_code, garment_profile_id, garment_profile_version, renderer, renderer_version);
--> statement-breakpoint
INSERT INTO app.garment_mockup_profiles (
  id, product_model_id, color_code, version, renderer_version, status, qualification, profile_data, development_only
) VALUES
  ('development-essential-tee-black-front-v1', 'essential-dtg-tee', 'black', 'v1', 'sharp-garment-profile-v1', 'ACTIVE', 'DEVELOPMENT / UNQUALIFIED', '{"blankAsset":"development-essential-tee-black-v1.png","placement":{"x":0.276,"y":0.285,"width":0.448,"height":0.34,"rotation":0},"mask":{"cornerRadius":0.035,"inset":0.015},"integration":{"artworkOpacity":0.97,"shadingOpacity":0.2,"highlightOpacity":0.06},"perspective":{"enabled":false}}'::jsonb, true),
  ('development-essential-tee-white-front-v1', 'essential-dtg-tee', 'white', 'v1', 'sharp-garment-profile-v1', 'ACTIVE', 'DEVELOPMENT / UNQUALIFIED', '{"blankAsset":"development-essential-tee-white-v1.png","placement":{"x":0.276,"y":0.285,"width":0.448,"height":0.34,"rotation":0},"mask":{"cornerRadius":0.035,"inset":0.015},"integration":{"artworkOpacity":0.97,"shadingOpacity":0.2,"highlightOpacity":0.06},"perspective":{"enabled":false}}'::jsonb, true),
  ('development-essential-tee-navy-front-v1', 'essential-dtg-tee', 'navy', 'v1', 'sharp-garment-profile-v1', 'ACTIVE', 'DEVELOPMENT / UNQUALIFIED', '{"blankAsset":"development-essential-tee-navy-v1.png","placement":{"x":0.276,"y":0.285,"width":0.448,"height":0.34,"rotation":0},"mask":{"cornerRadius":0.035,"inset":0.015},"integration":{"artworkOpacity":0.97,"shadingOpacity":0.2,"highlightOpacity":0.06},"perspective":{"enabled":false}}'::jsonb, true)
ON CONFLICT (id) DO NOTHING;
