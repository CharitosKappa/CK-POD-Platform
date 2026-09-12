ALTER TABLE app.customer_profiles
  ADD COLUMN preferred_locale text NOT NULL DEFAULT 'en'
    CHECK (preferred_locale IN ('en')),
  ADD COLUMN preferred_locale_source text NOT NULL DEFAULT 'DEFAULT'
    CHECK (preferred_locale_source IN ('DEFAULT', 'BROWSER', 'CUSTOMER', 'ADMIN')),
  ADD COLUMN preferred_locale_updated_at timestamptz;
--> statement-breakpoint
CREATE INDEX customer_profiles_preferred_locale_idx
  ON app.customer_profiles(preferred_locale, last_seen_at DESC);
