CREATE TABLE app.customer_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED')),
  selection_snapshot jsonb NOT NULL,
  total_count integer NOT NULL CHECK (total_count >= 0),
  processed_count integer NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  storage_key text,
  file_name text NOT NULL,
  failure_reason text,
  queue_job_id text,
  expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (processed_count <= total_count),
  CHECK (status <> 'READY' OR (storage_key IS NOT NULL AND completed_at IS NOT NULL AND expires_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX customer_exports_requester_created_idx
  ON app.customer_exports(requested_by_staff_member_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX customer_exports_pending_idx
  ON app.customer_exports(status, created_at) WHERE status IN ('QUEUED', 'PROCESSING');
--> statement-breakpoint
CREATE INDEX customer_exports_expiry_idx
  ON app.customer_exports(expires_at) WHERE status = 'READY';
