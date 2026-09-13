ALTER TABLE app.orders
  ADD COLUMN customer_profile_id uuid
  REFERENCES app.customer_profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
UPDATE app.orders orders
SET customer_profile_id = customer.id
FROM app.customer_profiles customer
WHERE orders.customer_profile_id IS NULL
  AND lower(trim(orders.customer_email)) = customer.normalized_email;
--> statement-breakpoint
CREATE INDEX orders_customer_profile_created_idx
  ON app.orders(customer_profile_id, created_at DESC)
  WHERE customer_profile_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX orders_normalized_customer_email_created_idx
  ON app.orders(lower(trim(customer_email)), created_at DESC)
  WHERE customer_profile_id IS NULL;
