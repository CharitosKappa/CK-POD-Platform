CREATE TABLE app.customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email text NOT NULL UNIQUE,
  user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  first_seen_source text NOT NULL CHECK (first_seen_source IN ('ACCOUNT', 'CHECKOUT', 'ORDER', 'NEWSLETTER')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX customer_profiles_last_seen_idx ON app.customer_profiles(last_seen_at DESC);
--> statement-breakpoint
CREATE INDEX customer_profiles_user_idx ON app.customer_profiles(user_id) WHERE user_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE app.customer_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  value text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(value) BETWEEN 1 AND 48)
);
--> statement-breakpoint
CREATE TABLE app.customer_profile_tags (
  customer_profile_id uuid NOT NULL REFERENCES app.customer_profiles(id) ON DELETE CASCADE,
  customer_tag_id uuid NOT NULL REFERENCES app.customer_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_profile_id, customer_tag_id)
);
--> statement-breakpoint
CREATE INDEX customer_profile_tags_tag_idx ON app.customer_profile_tags(customer_tag_id, customer_profile_id);
--> statement-breakpoint
CREATE TABLE app.customer_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id uuid NOT NULL REFERENCES app.customer_profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('NOTE', 'TAGS_UPDATED', 'PROFILE_CREATED')),
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((event_type = 'NOTE' AND body IS NOT NULL) OR event_type <> 'NOTE')
);
--> statement-breakpoint
CREATE INDEX customer_timeline_events_customer_idx
  ON app.customer_timeline_events(customer_profile_id, created_at DESC);
--> statement-breakpoint
INSERT INTO app.customer_profiles (
  normalized_email, user_id, first_seen_source, first_seen_at, last_seen_at
)
SELECT lower(trim(email)), id, 'ACCOUNT', created_at, created_at
FROM app.users
WHERE email_verified_at IS NOT NULL
ON CONFLICT (normalized_email) DO UPDATE
SET user_id = COALESCE(app.customer_profiles.user_id, EXCLUDED.user_id),
    first_seen_at = LEAST(app.customer_profiles.first_seen_at, EXCLUDED.first_seen_at),
    last_seen_at = GREATEST(app.customer_profiles.last_seen_at, EXCLUDED.last_seen_at),
    updated_at = now();
--> statement-breakpoint
INSERT INTO app.customer_profiles (
  normalized_email, user_id, first_seen_source, first_seen_at, last_seen_at
)
SELECT lower(trim(customer_email)), NULL::uuid, 'ORDER', min(created_at), max(created_at)
FROM app.orders
WHERE customer_email IS NOT NULL AND trim(customer_email) <> ''
GROUP BY lower(trim(customer_email))
ON CONFLICT (normalized_email) DO UPDATE
SET user_id = COALESCE(app.customer_profiles.user_id, EXCLUDED.user_id),
    first_seen_at = LEAST(app.customer_profiles.first_seen_at, EXCLUDED.first_seen_at),
    last_seen_at = GREATEST(app.customer_profiles.last_seen_at, EXCLUDED.last_seen_at),
    updated_at = now();
