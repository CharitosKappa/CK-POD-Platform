ALTER TABLE app.customer_profiles
  ADD COLUMN first_name text,
  ADD COLUMN last_name text,
  ADD COLUMN phone text,
  ADD COLUMN email_marketing_status text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (email_marketing_status IN ('UNKNOWN', 'NOT_SUBSCRIBED', 'SUBSCRIBED')),
  ADD COLUMN email_marketing_updated_at timestamptz,
  ADD COLUMN sms_marketing_status text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (sms_marketing_status IN ('UNKNOWN', 'NOT_SUBSCRIBED', 'SUBSCRIBED')),
  ADD COLUMN sms_marketing_updated_at timestamptz;
--> statement-breakpoint
CREATE INDEX customer_profiles_email_marketing_idx
  ON app.customer_profiles(email_marketing_status, last_seen_at DESC);
--> statement-breakpoint
CREATE INDEX customer_profiles_sms_marketing_idx
  ON app.customer_profiles(sms_marketing_status, last_seen_at DESC);
--> statement-breakpoint
CREATE TABLE app.customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id uuid NOT NULL REFERENCES app.customer_profiles(id) ON DELETE CASCADE,
  recipient_name text NOT NULL,
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  state_code text,
  postal_code text NOT NULL,
  country_code text NOT NULL,
  phone text,
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(recipient_name) BETWEEN 1 AND 160),
  CHECK (char_length(line1) BETWEEN 1 AND 240),
  CHECK (line2 IS NULL OR char_length(line2) <= 240),
  CHECK (char_length(city) BETWEEN 1 AND 120),
  CHECK (state_code IS NULL OR char_length(state_code) <= 120),
  CHECK (char_length(postal_code) BETWEEN 1 AND 32),
  CHECK (char_length(country_code) BETWEEN 2 AND 2),
  CHECK (phone IS NULL OR char_length(phone) <= 40)
);
--> statement-breakpoint
CREATE INDEX customer_addresses_profile_idx
  ON app.customer_addresses(customer_profile_id, updated_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_addresses_one_default_per_profile_idx
  ON app.customer_addresses(customer_profile_id) WHERE is_default;
--> statement-breakpoint
ALTER TABLE app.customer_timeline_events
  DROP CONSTRAINT customer_timeline_events_event_type_check;
--> statement-breakpoint
ALTER TABLE app.customer_timeline_events
  ADD CONSTRAINT customer_timeline_events_event_type_check
  CHECK (event_type IN (
    'NOTE', 'TAGS_UPDATED', 'PROFILE_CREATED', 'PROFILE_UPDATED', 'CONSENT_UPDATED'
  ));
