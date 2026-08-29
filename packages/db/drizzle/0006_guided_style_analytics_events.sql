--> statement-breakpoint
CREATE TABLE app.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL CHECK (event_name IN ('generation_started', 'generation_succeeded', 'generation_failed', 'generation_rejected_internal')),
  project_id uuid NOT NULL REFERENCES app.projects(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL REFERENCES app.generations(id) ON DELETE CASCADE,
  dimensions jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX analytics_events_generation_idx ON app.analytics_events(generation_id, occurred_at);
--> statement-breakpoint
CREATE INDEX analytics_events_style_attribution_idx
  ON app.analytics_events ((dimensions->>'styleFamilyId'), (dimensions->>'presetId'), (dimensions->>'presetVersion'));
