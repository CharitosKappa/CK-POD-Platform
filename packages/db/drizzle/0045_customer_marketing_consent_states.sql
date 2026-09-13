ALTER TABLE app.customer_profiles
  DROP CONSTRAINT IF EXISTS customer_profiles_email_marketing_status_check,
  DROP CONSTRAINT IF EXISTS customer_profiles_sms_marketing_status_check;
--> statement-breakpoint
UPDATE app.customer_profiles AS profile
SET email_marketing_status = 'UNSUBSCRIBED'
WHERE profile.email_marketing_status = 'NOT_SUBSCRIBED'
  AND EXISTS (
    SELECT 1
    FROM app.customer_timeline_events AS event
    WHERE event.customer_profile_id = profile.id
      AND event.event_type = 'CONSENT_UPDATED'
      AND event.metadata->>'emailMarketingStatus' = 'SUBSCRIBED'
  );
--> statement-breakpoint
UPDATE app.customer_profiles AS profile
SET sms_marketing_status = 'UNSUBSCRIBED'
WHERE profile.sms_marketing_status = 'NOT_SUBSCRIBED'
  AND EXISTS (
    SELECT 1
    FROM app.customer_timeline_events AS event
    WHERE event.customer_profile_id = profile.id
      AND event.event_type = 'CONSENT_UPDATED'
      AND event.metadata->>'smsMarketingStatus' = 'SUBSCRIBED'
  );
--> statement-breakpoint
UPDATE app.customer_profiles
SET email_marketing_status = 'NOT_SUBSCRIBED'
WHERE email_marketing_status = 'UNKNOWN';
--> statement-breakpoint
UPDATE app.customer_profiles
SET sms_marketing_status = 'NOT_SUBSCRIBED'
WHERE sms_marketing_status = 'UNKNOWN';
--> statement-breakpoint
ALTER TABLE app.customer_profiles
  ALTER COLUMN email_marketing_status SET DEFAULT 'NOT_SUBSCRIBED',
  ALTER COLUMN sms_marketing_status SET DEFAULT 'NOT_SUBSCRIBED',
  ADD CONSTRAINT customer_profiles_email_marketing_status_check
    CHECK (email_marketing_status IN ('NOT_SUBSCRIBED', 'SUBSCRIBED', 'UNSUBSCRIBED')),
  ADD CONSTRAINT customer_profiles_sms_marketing_status_check
    CHECK (sms_marketing_status IN ('NOT_SUBSCRIBED', 'SUBSCRIBED', 'UNSUBSCRIBED'));
