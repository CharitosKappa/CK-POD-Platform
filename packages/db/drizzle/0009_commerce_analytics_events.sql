--> statement-breakpoint
ALTER TABLE app.analytics_events ALTER COLUMN generation_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app.analytics_events DROP CONSTRAINT analytics_events_event_name_check;
--> statement-breakpoint
ALTER TABLE app.analytics_events
  ADD CONSTRAINT analytics_events_event_name_check
  CHECK (event_name IN (
    'generation_started', 'generation_succeeded', 'generation_failed', 'generation_rejected_internal',
    'proof_approved', 'add_to_cart', 'checkout_started', 'payment_succeeded',
    'payment_failed', 'shipping_option_selected', 'tax_calculated', 'order_created'
  ));
