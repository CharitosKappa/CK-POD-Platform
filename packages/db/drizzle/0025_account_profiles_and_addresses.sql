CREATE TABLE app.account_profiles (
  user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.saved_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  recipient_name text NOT NULL,
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  state_code text NOT NULL,
  postal_code text NOT NULL,
  country_code text NOT NULL DEFAULT 'US',
  phone text,
  is_default boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX saved_addresses_user_idx ON app.saved_addresses(user_id, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX saved_addresses_one_default_per_user_idx
  ON app.saved_addresses(user_id) WHERE is_default;
