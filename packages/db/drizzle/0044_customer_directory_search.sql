CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX customer_profiles_email_trgm_idx
  ON app.customer_profiles USING gin (normalized_email gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX customer_profiles_name_trgm_idx
  ON app.customer_profiles USING gin (
    ((coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) gin_trgm_ops
  );
--> statement-breakpoint
CREATE INDEX customer_profiles_phone_trgm_idx
  ON app.customer_profiles USING gin ((coalesce(phone, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX account_profiles_name_trgm_idx
  ON app.account_profiles USING gin (
    ((coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) gin_trgm_ops
  );
--> statement-breakpoint
CREATE INDEX customer_addresses_search_trgm_idx
  ON app.customer_addresses USING gin (
    ((coalesce(recipient_name, '') || ' ' || coalesce(line1, '') || ' ' ||
      coalesce(line2, '') || ' ' || coalesce(city, '') || ' ' ||
      coalesce(state_code, '') || ' ' || coalesce(postal_code, '') || ' ' ||
      coalesce(country_code, '') || ' ' || coalesce(phone, ''))) gin_trgm_ops
  );
--> statement-breakpoint
CREATE INDEX saved_addresses_search_trgm_idx
  ON app.saved_addresses USING gin (
    ((coalesce(recipient_name, '') || ' ' || coalesce(line1, '') || ' ' ||
      coalesce(line2, '') || ' ' || coalesce(city, '') || ' ' ||
      coalesce(state_code, '') || ' ' || coalesce(postal_code, '') || ' ' ||
      coalesce(country_code, '') || ' ' || coalesce(phone, ''))) gin_trgm_ops
  );
--> statement-breakpoint
CREATE INDEX orders_shipping_address_search_trgm_idx
  ON app.orders USING gin (
    ((coalesce(shipping_address_snapshot->>'recipientName', '') || ' ' ||
      coalesce(shipping_address_snapshot->>'line1', '') || ' ' ||
      coalesce(shipping_address_snapshot->>'line2', '') || ' ' ||
      coalesce(shipping_address_snapshot->>'city', '') || ' ' ||
      coalesce(shipping_address_snapshot->>'stateCode', '') || ' ' ||
      coalesce(shipping_address_snapshot->>'postalCode', '') || ' ' ||
      coalesce(shipping_address_snapshot->>'countryCode', ''))) gin_trgm_ops
  );
