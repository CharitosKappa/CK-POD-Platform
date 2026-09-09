ALTER TABLE app.checkout_attempts
  ADD COLUMN billing_address_snapshot jsonb;
--> statement-breakpoint
UPDATE app.checkout_attempts checkout_attempt
SET billing_address_snapshot = jsonb_build_object(
  'recipientName', shipping.recipient_name,
  'line1', shipping.line1,
  'line2', shipping.line2,
  'city', shipping.city,
  'stateCode', shipping.state_code,
  'postalCode', shipping.postal_code,
  'countryCode', shipping.country_code
)
FROM app.shipping_addresses shipping
WHERE shipping.id = checkout_attempt.shipping_address_id;
--> statement-breakpoint
ALTER TABLE app.checkout_attempts
  ALTER COLUMN billing_address_snapshot SET NOT NULL;
--> statement-breakpoint
ALTER TABLE app.orders
  ADD COLUMN billing_address_snapshot jsonb;
--> statement-breakpoint
UPDATE app.orders orders
SET billing_address_snapshot = checkout_attempt.billing_address_snapshot
FROM app.checkout_attempts checkout_attempt
WHERE checkout_attempt.id = orders.checkout_attempt_id;
--> statement-breakpoint
ALTER TABLE app.orders
  ALTER COLUMN billing_address_snapshot SET NOT NULL;
