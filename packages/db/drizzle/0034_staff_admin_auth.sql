CREATE TABLE app.staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), normalized_email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('OWNER', 'OPERATIONS', 'PREPRESS', 'READ_ONLY')),
  status text NOT NULL CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED')),
  invited_at timestamptz NOT NULL DEFAULT now(), activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.staff_email_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email_hash text NOT NULL, code_hash text NOT NULL,
  expires_at timestamptz NOT NULL, attempt_count smallint NOT NULL DEFAULT 0, consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX staff_email_challenges_active_idx ON app.staff_email_challenges(email_hash, created_at DESC) WHERE consumed_at IS NULL;
--> statement-breakpoint
CREATE TABLE app.staff_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_member_id uuid NOT NULL REFERENCES app.staff_members(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX staff_sessions_active_idx ON app.staff_sessions(token_hash, expires_at) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TABLE app.staff_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX staff_audit_events_member_created_idx ON app.staff_audit_events(staff_member_id, created_at DESC);
