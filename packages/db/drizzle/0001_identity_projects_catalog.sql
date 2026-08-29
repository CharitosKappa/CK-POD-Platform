--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid REFERENCES app.users(id) ON DELETE CASCADE,
  session_kind text NOT NULL CHECK (session_kind IN ('GUEST', 'AUTHENTICATED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX sessions_token_hash_idx ON app.sessions(token_hash);
--> statement-breakpoint
CREATE TABLE app.product_models (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  description text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  starting_price_cents integer NOT NULL CHECK (starting_price_cents >= 0),
  image_url text NOT NULL,
  development_only boolean NOT NULL DEFAULT true,
  fulfillment_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE app.product_variants (
  id text PRIMARY KEY,
  product_model_id text NOT NULL REFERENCES app.product_models(id) ON DELETE CASCADE,
  color_code text NOT NULL,
  color_name text NOT NULL,
  size text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  image_url text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  fulfillment_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (product_model_id, color_code, size)
);
--> statement-breakpoint
CREATE INDEX product_variants_model_color_idx ON app.product_variants(product_model_id, color_code);
--> statement-breakpoint
CREATE TABLE app.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('GUEST', 'USER')),
  owner_session_id uuid REFERENCES app.sessions(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES app.users(id) ON DELETE CASCADE,
  product_model_id text REFERENCES app.product_models(id),
  selected_color_code text,
  active_version_id uuid,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (owner_type = 'GUEST' AND owner_session_id IS NOT NULL AND owner_user_id IS NULL)
    OR (owner_type = 'USER' AND owner_user_id IS NOT NULL AND owner_session_id IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX projects_guest_owner_idx ON app.projects(owner_session_id) WHERE owner_type = 'GUEST';
--> statement-breakpoint
CREATE INDEX projects_user_owner_idx ON app.projects(owner_user_id) WHERE owner_type = 'USER';
--> statement-breakpoint
CREATE TABLE app.project_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  editor_document jsonb NOT NULL,
  document_hash text NOT NULL,
  snapshot_reason text NOT NULL CHECK (snapshot_reason IN ('INITIAL', 'AUTOSAVE', 'GENERATION', 'DESTRUCTIVE_EDIT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_session_id uuid REFERENCES app.sessions(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  UNIQUE (project_id, version_number)
);
--> statement-breakpoint
ALTER TABLE app.projects
  ADD CONSTRAINT projects_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES app.project_versions(id) ON DELETE SET NULL;
--> statement-breakpoint
INSERT INTO app.product_models (id, display_name, description, status, starting_price_cents, image_url, development_only)
VALUES (
  'essential-dtg-tee',
  'Essential DTG T-Shirt',
  'A development-only MVP T-shirt seed for product selection.',
  'ACTIVE',
  2900,
  '/images/development-essential-tee.svg',
  true
)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO app.product_variants (id, product_model_id, color_code, color_name, size, price_cents, image_url, status)
SELECT
  'essential-dtg-tee-' || color_code || '-' || size,
  'essential-dtg-tee',
  color_code,
  color_name,
  size,
  2900,
  '/images/development-essential-tee.svg',
  'ACTIVE'
FROM (VALUES
  ('black', 'Black'),
  ('white', 'White'),
  ('navy', 'Navy')
) AS colors(color_code, color_name)
CROSS JOIN (VALUES ('S'), ('M'), ('L'), ('XL')) AS sizes(size)
ON CONFLICT (id) DO NOTHING;
