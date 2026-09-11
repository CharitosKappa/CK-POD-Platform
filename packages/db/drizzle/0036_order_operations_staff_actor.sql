ALTER TABLE app.order_state_history
  ADD COLUMN actor_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE app.order_reviews
  ADD COLUMN actor_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE app.order_holds
  ADD COLUMN held_by_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL,
  ADD COLUMN resumed_by_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE app.order_final_routing
  ADD COLUMN created_by_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE app.order_provider_overrides
  ALTER COLUMN actor_user_id DROP NOT NULL,
  ADD COLUMN actor_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  ADD CONSTRAINT order_provider_overrides_actor_check
    CHECK (num_nonnulls(actor_user_id, actor_staff_member_id) = 1);
--> statement-breakpoint
ALTER TABLE app.order_readiness_evaluations
  ADD COLUMN created_by_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE app.order_fulfillment_actions
  ADD COLUMN requested_by_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE app.order_operational_audits
  ADD COLUMN actor_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE app.order_fulfillment_group_readiness_evaluations
  ADD COLUMN created_by_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE app.policy_human_decisions
  ALTER COLUMN actor_user_id DROP NOT NULL,
  ADD COLUMN actor_staff_member_id uuid REFERENCES app.staff_members(id) ON DELETE RESTRICT,
  ADD CONSTRAINT policy_human_decisions_actor_check
    CHECK (num_nonnulls(actor_user_id, actor_staff_member_id) = 1);
