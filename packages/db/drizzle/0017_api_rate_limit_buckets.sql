--> statement-breakpoint
CREATE TABLE app.api_rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX api_rate_limit_buckets_updated_idx ON app.api_rate_limit_buckets(updated_at);
