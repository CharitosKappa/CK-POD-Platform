--> statement-breakpoint
CREATE TABLE app.privacy_subject_controls (
  user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE RESTRICT,
  marketing_identifier_hash text UNIQUE,
  marketing_suppressed_at timestamptz,
  anonymized_at timestamptz,
  retention_hold boolean NOT NULL DEFAULT false,
  retention_hold_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT retention_hold OR retention_hold_reason IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE app.privacy_data_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'ACCOUNT_ANONYMIZED', 'MARKETING_SUPPRESSED', 'UNFINISHED_PROJECT_DELETED'
  )),
  status text NOT NULL CHECK (status IN ('COMPLETED', 'BLOCKED', 'DRY_RUN')),
  reason_code text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX privacy_data_actions_user_idx
  ON app.privacy_data_actions(user_id, created_at DESC);
