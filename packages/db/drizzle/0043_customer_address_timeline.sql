ALTER TABLE app.customer_timeline_events
  DROP CONSTRAINT customer_timeline_events_event_type_check;
--> statement-breakpoint
ALTER TABLE app.customer_timeline_events
  ADD CONSTRAINT customer_timeline_events_event_type_check
  CHECK (event_type IN (
    'NOTE', 'TAGS_UPDATED', 'PROFILE_CREATED', 'PROFILE_UPDATED', 'CONSENT_UPDATED',
    'ADDRESS_ADDED', 'ADDRESS_UPDATED', 'ADDRESS_REMOVED'
  ));
