ALTER TABLE app.customer_timeline_events
  ADD COLUMN actor_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL;
