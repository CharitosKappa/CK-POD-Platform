--> statement-breakpoint
ALTER TABLE app.users
  ALTER COLUMN password_hash DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app.users
  ADD COLUMN email_verified_at timestamptz;
--> statement-breakpoint
UPDATE app.users
SET email_verified_at = created_at
WHERE email_verified_at IS NULL;
--> statement-breakpoint
ALTER TABLE app.users
  ALTER COLUMN email_verified_at SET NOT NULL;
--> statement-breakpoint
CREATE TABLE app.email_login_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 5),
  consumed_at timestamptz,
  delivery_channel text NOT NULL DEFAULT 'LOCAL',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX email_login_challenges_active_lookup_idx
  ON app.email_login_challenges (email_hash, created_at DESC)
  WHERE consumed_at IS NULL;
