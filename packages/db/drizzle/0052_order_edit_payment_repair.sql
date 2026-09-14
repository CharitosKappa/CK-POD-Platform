-- Repair databases that applied the original 0051 migration while preserving all
-- externally ambiguous attempts and refunds for read-only reconciliation.
UPDATE app.order_edit_payment_attempts
SET provider_submission_started_at=COALESCE(provider_submission_started_at,updated_at,created_at)
WHERE status='PREPARING'
   OR (status='FAILED' AND provider_payment_id IS NOT NULL);
--> statement-breakpoint
DROP INDEX IF EXISTS app.order_edit_payment_attempts_one_active_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX order_edit_payment_attempts_one_active_idx
  ON app.order_edit_payment_attempts(order_id)
  WHERE status IN ('PREPARING','PENDING');
--> statement-breakpoint
INSERT INTO app.order_payment_captures
  (order_id,order_edit_payment_attempt_id,provider,provider_payment_id,amount_cents,
   currency,request_snapshot,captured_at)
SELECT attempt.order_id,attempt.id,attempt.provider,attempt.provider_payment_id,
       attempt.amount_cents,attempt.currency,attempt.request_snapshot,
       COALESCE(attempt.completed_at,attempt.updated_at,attempt.created_at)
FROM app.order_edit_payment_attempts attempt
WHERE attempt.status='SUCCEEDED'
  AND attempt.provider IS NOT NULL
  AND attempt.provider_payment_id IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE app.order_refunds DROP CONSTRAINT IF EXISTS order_refunds_status_check;
--> statement-breakpoint
ALTER TABLE app.order_refunds
  ADD CONSTRAINT order_refunds_status_check
  CHECK (status IN ('PENDING','SUCCEEDED','PARTIAL','FAILED'));
--> statement-breakpoint
ALTER TABLE app.order_refund_allocations
  ADD COLUMN IF NOT EXISTS submission_state text;
--> statement-breakpoint
ALTER TABLE app.order_refund_allocations
  ADD COLUMN IF NOT EXISTS allocation_sequence integer;
--> statement-breakpoint
WITH sequenced AS (
  SELECT id,row_number() OVER (
    PARTITION BY order_refund_id
    ORDER BY
      CASE
        WHEN idempotency_key ~ ':capture:[1-9][0-9]*$'
          THEN substring(idempotency_key FROM ':capture:([1-9][0-9]*)$')::numeric
      END NULLS LAST,
      created_at,
      id
  )::int AS sequence
  FROM app.order_refund_allocations
)
UPDATE app.order_refund_allocations allocation
SET allocation_sequence=sequenced.sequence
FROM sequenced
WHERE allocation.id=sequenced.id AND allocation.allocation_sequence IS NULL;
--> statement-breakpoint
ALTER TABLE app.order_refund_allocations
  ALTER COLUMN allocation_sequence SET NOT NULL;
--> statement-breakpoint
ALTER TABLE app.order_refund_allocations
  DROP CONSTRAINT IF EXISTS order_refund_allocations_sequence_positive_check,
  DROP CONSTRAINT IF EXISTS order_refund_allocations_refund_sequence_unique;
--> statement-breakpoint
ALTER TABLE app.order_refund_allocations
  ADD CONSTRAINT order_refund_allocations_sequence_positive_check
  CHECK (allocation_sequence > 0),
  ADD CONSTRAINT order_refund_allocations_refund_sequence_unique
  UNIQUE (order_refund_id,allocation_sequence);
--> statement-breakpoint
WITH unresolved AS (
  SELECT allocation.id,
         row_number() OVER (
           PARTITION BY allocation.order_refund_id
           ORDER BY allocation.allocation_sequence
         ) AS unresolved_position
  FROM app.order_refund_allocations allocation
  WHERE allocation.status='PENDING'
    AND allocation.provider_refund_id IS NULL
    AND allocation.submission_state IS NULL
)
UPDATE app.order_refund_allocations allocation
SET submission_state=CASE
  WHEN unresolved.unresolved_position=1 THEN 'SUBMISSION_STARTED'
  ELSE 'UNSUBMITTED'
END
FROM unresolved
WHERE allocation.id=unresolved.id;
--> statement-breakpoint
UPDATE app.order_refund_allocations
SET submission_state=CASE
  WHEN provider_refund_id IS NOT NULL THEN 'IDENTIFIED'
  ELSE 'SUBMISSION_STARTED'
END
WHERE submission_state IS NULL;
--> statement-breakpoint
ALTER TABLE app.order_refund_allocations
  ALTER COLUMN submission_state SET DEFAULT 'UNSUBMITTED',
  ALTER COLUMN submission_state SET NOT NULL;
--> statement-breakpoint
ALTER TABLE app.order_refund_allocations
  DROP CONSTRAINT IF EXISTS order_refund_allocations_submission_state_check;
--> statement-breakpoint
ALTER TABLE app.order_refund_allocations
  ADD CONSTRAINT order_refund_allocations_submission_state_check
  CHECK (submission_state IN ('UNSUBMITTED','SUBMISSION_STARTED','IDENTIFIED'));
--> statement-breakpoint
UPDATE app.order_refund_allocations allocation
SET idempotency_key=refund.idempotency_key
FROM app.order_refunds refund
WHERE allocation.order_refund_id=refund.id
  AND allocation.idempotency_key=refund.idempotency_key || ':capture:1'
  AND (SELECT count(*) FROM app.order_refund_allocations sibling
       WHERE sibling.order_refund_id=refund.id)=1
  AND NOT EXISTS (
    SELECT 1 FROM app.order_refund_allocations existing
    WHERE existing.id<>allocation.id AND existing.idempotency_key=refund.idempotency_key
  );
