UPDATE app.product_models
SET display_name = 'Classic T-Shirt',
    description = 'Comfort Colors 1717 garment prepared for the production creation journey.',
    starting_price_cents = 3999,
    image_url = '/garments/classic-tee-black.png',
    updated_at = now()
WHERE id = 'essential-dtg-tee';
--> statement-breakpoint
INSERT INTO app.product_variants (
  id, product_model_id, color_code, color_name, size, price_cents, image_url, status
)
SELECT
  'essential-dtg-tee-' || color_code || '-' || size,
  'essential-dtg-tee',
  color_code,
  color_name,
  size,
  CASE size WHEN '2XL' THEN 4299 WHEN '3XL' THEN 4499 WHEN '4XL' THEN 4699 ELSE 3999 END,
  CASE color_code
    WHEN 'black' THEN '/garments/classic-tee-black.png'
    WHEN 'navy' THEN '/garments/classic-tee-navy.png'
    ELSE '/garments/classic-tee-white.png'
  END,
  'ACTIVE'
FROM (VALUES
  ('white', 'White'),
  ('ivory', 'Ivory'),
  ('pepper', 'Pepper'),
  ('black', 'Black'),
  ('mustard', 'Mustard'),
  ('yam', 'Yam'),
  ('grey', 'Grey'),
  ('moss', 'Moss'),
  ('light-green', 'Light Green'),
  ('chambray', 'Chambray'),
  ('flo-blue', 'Flo Blue'),
  ('graphite', 'Graphite'),
  ('violet', 'Violet'),
  ('orchid', 'Orchid'),
  ('blossom', 'Blossom'),
  ('crunchberry', 'Crunchberry'),
  ('berry', 'Berry'),
  ('watermelon', 'Watermelon'),
  ('bay', 'Bay'),
  ('blue-jean', 'Blue Jean'),
  ('crimson', 'Crimson'),
  ('butter', 'Butter'),
  ('chalky-mint', 'Chalky Mint'),
  ('blue-spruce', 'Blue Spruce'),
  ('brick', 'Brick'),
  ('espresso', 'Espresso'),
  ('island-reef', 'Island Reef'),
  ('lagoon-blue', 'Lagoon Blue'),
  ('sapphire', 'Sapphire'),
  ('navy', 'Navy'),
  ('neon-pink', 'Neon Pink'),
  ('chili', 'Chili'),
  ('red', 'Red')
) AS colors(color_code, color_name)
CROSS JOIN (VALUES ('S'), ('M'), ('L'), ('XL'), ('2XL'), ('3XL'), ('4XL')) AS sizes(size)
WHERE NOT (color_code IN ('blue-spruce', 'grey') AND size = '4XL')
ON CONFLICT (id) DO UPDATE SET
  color_name = EXCLUDED.color_name,
  price_cents = EXCLUDED.price_cents,
  image_url = EXCLUDED.image_url,
  status = EXCLUDED.status;
--> statement-breakpoint
INSERT INTO app.fulfillment_variant_mappings (
  product_variant_id, adapter_type, external_variant_id, external_metadata
)
SELECT id, 'PRINTIFY', 'fake-' || id, '{"catalog":"development-fake"}'::jsonb
FROM app.product_variants
WHERE product_model_id = 'essential-dtg-tee'
ON CONFLICT (product_variant_id, adapter_type) DO NOTHING;
