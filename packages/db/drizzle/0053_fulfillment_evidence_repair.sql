-- The original 0046 backfill trusted the legacy group status for delivery. Delivery
-- is a stronger claim and requires durable shipment evidence. Preserve the weaker
-- fulfilled inference while correcting unsupported Delivered projections.
WITH candidates AS (
  SELECT fulfillment_group.id,fulfillment_group.order_id,
         CASE
           WHEN fulfillment_group.status IN ('SHIPPED','DELIVERED') OR EXISTS (
             SELECT 1 FROM app.order_shipments shipment
             WHERE shipment.fulfillment_group_id=fulfillment_group.id
               AND (shipment.shipped_at IS NOT NULL OR lower(shipment.status) IN ('shipped','delivered'))
           ) THEN 'FULFILLED'
           ELSE 'UNFULFILLED'
         END AS corrected_state
  FROM app.order_fulfillment_groups fulfillment_group
  WHERE fulfillment_group.fulfillment_status='DELIVERED'
    AND EXISTS (
      SELECT 1 FROM app.order_fulfillment_status_history history
      WHERE history.fulfillment_group_id=fulfillment_group.id
        AND history.source='MIGRATION'
        AND history.from_state IS NULL
        AND history.to_state='DELIVERED'
        AND history.metadata->>'legacyGroupStatus'='DELIVERED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM app.order_fulfillment_status_history history
      WHERE history.fulfillment_group_id=fulfillment_group.id
        AND history.source<>'MIGRATION'
        AND history.to_state='DELIVERED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM app.order_shipments shipment
      WHERE shipment.fulfillment_group_id=fulfillment_group.id
        AND (shipment.delivered_at IS NOT NULL OR lower(shipment.status)='delivered')
    )
), repaired AS (
  UPDATE app.order_fulfillment_groups fulfillment_group
  SET fulfillment_status=candidates.corrected_state
  FROM candidates
  WHERE fulfillment_group.id=candidates.id
  RETURNING fulfillment_group.id,fulfillment_group.order_id,fulfillment_group.fulfillment_status
)
INSERT INTO app.order_fulfillment_status_history
  (order_id,fulfillment_group_id,from_state,to_state,source,metadata)
SELECT repaired.order_id,repaired.id,'DELIVERED',repaired.fulfillment_status,'MIGRATION',
       jsonb_build_object('reason','delivery-evidence-missing','repairMigration','0053')
FROM repaired;
