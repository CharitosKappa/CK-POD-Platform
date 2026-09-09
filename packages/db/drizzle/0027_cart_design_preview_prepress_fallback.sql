-- Older cart rows may predate a source-generation lineage. Their approved controlled
-- prepress preview is still a safe artwork-only representation for cart/account surfaces.
UPDATE app.cart_items item
SET design_preview_asset_id = run.preview_asset_id
FROM app.prepress_runs run
JOIN app.assets preview
  ON preview.id = run.preview_asset_id
 AND preview.asset_type = 'PREPRESS_PREVIEW'
 AND preview.status = 'ACTIVE'
WHERE item.prepress_run_id = run.id
  AND item.design_preview_asset_id IS NULL;
