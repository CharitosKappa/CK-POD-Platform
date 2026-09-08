CREATE TABLE app.project_creation_drafts (
  project_id uuid PRIMARY KEY REFERENCES app.projects(id) ON DELETE CASCADE,
  prompt text NOT NULL DEFAULT '',
  reference_asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  prototype_style_id text,
  prototype_tone_id text NOT NULL DEFAULT 'auto',
  selected_size text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(reference_asset_ids) = 'array')
);
--> statement-breakpoint
INSERT INTO app.project_creation_drafts (project_id)
SELECT id FROM app.projects
ON CONFLICT (project_id) DO NOTHING;
