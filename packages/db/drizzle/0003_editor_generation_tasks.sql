--> statement-breakpoint
ALTER TABLE app.generations
  ADD COLUMN task text NOT NULL DEFAULT 'TEXT_TO_ARTWORK'
  CHECK (task IN ('TEXT_TO_ARTWORK', 'SELECTED_ELEMENT_EDITING'));
--> statement-breakpoint
ALTER TABLE app.generations
  ADD COLUMN editor_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE INDEX generations_task_idx ON app.generations(project_id, task, created_at DESC);
