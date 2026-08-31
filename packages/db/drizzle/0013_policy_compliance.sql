--> statement-breakpoint
CREATE TABLE app.policy_rulesets (
  id text PRIMARY KEY,
  version integer NOT NULL CHECK (version > 0),
  description text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (id, version)
);
--> statement-breakpoint
INSERT INTO app.policy_rulesets (id, version, description, status, configuration)
VALUES (
  'm8-mvp-2026-08', 1,
  'Milestone 8 MVP safety, IP-risk, fan-art, likeness, protected-text, and violence policy.',
  'ACTIVE',
  '{"fanArt":"prohibited","production":"manual-review"}'::jsonb
) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
CREATE TABLE app.policy_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id text NOT NULL REFERENCES app.policy_rulesets(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('PROMPT_PRE_GENERATION', 'REFERENCE_UPLOAD', 'GENERATED_OUTPUT', 'FINAL_ARTWORK_PRE_PRODUCTION')),
  machine_result text NOT NULL CHECK (machine_result IN ('ALLOW', 'BLOCK', 'REVIEW', 'UNKNOWN')),
  classifier_id text NOT NULL,
  classifier_version text NOT NULL,
  project_id uuid REFERENCES app.projects(id) ON DELETE SET NULL,
  project_version_id uuid REFERENCES app.project_versions(id) ON DELETE SET NULL,
  generation_id uuid REFERENCES app.generations(id) ON DELETE SET NULL,
  order_id uuid REFERENCES app.orders(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES app.assets(id) ON DELETE SET NULL,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  classifier_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX policy_evaluations_project_stage_idx ON app.policy_evaluations(project_id, project_version_id, stage, created_at DESC);
--> statement-breakpoint
CREATE INDEX policy_evaluations_order_stage_idx ON app.policy_evaluations(order_id, stage, created_at DESC);
--> statement-breakpoint
CREATE TABLE app.policy_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES app.policy_evaluations(id) ON DELETE CASCADE,
  category text NOT NULL,
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  confidence numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  affected_artifact jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX policy_findings_evaluation_idx ON app.policy_findings(evaluation_id);
--> statement-breakpoint
CREATE TABLE app.policy_human_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES app.policy_evaluations(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES app.orders(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'HELD', 'ESCALATED')),
  reason_code text NOT NULL,
  notes text,
  actor_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX policy_human_decisions_evaluation_idx ON app.policy_human_decisions(evaluation_id, created_at DESC);
