ALTER TABLE app.cart_items
  ADD COLUMN design_preview_asset_id uuid REFERENCES app.assets(id) ON DELETE RESTRICT;
--> statement-breakpoint
UPDATE app.cart_items item
SET design_preview_asset_id = preview.id
FROM app.prepress_runs run
JOIN app.asset_lineage render_source
  ON render_source.derived_asset_id = run.production_master_asset_id
 AND render_source.relationship = 'PRODUCTION_RENDER_SOURCE'
JOIN app.assets source ON source.id = render_source.source_asset_id
JOIN app.assets preview
  ON preview.generation_id = source.generation_id
 AND preview.asset_type = 'PREVIEW'
 AND preview.status = 'ACTIVE'
WHERE item.prepress_run_id = run.id
  AND item.design_preview_asset_id IS NULL;
--> statement-breakpoint
CREATE INDEX cart_items_design_preview_idx ON app.cart_items(design_preview_asset_id);
