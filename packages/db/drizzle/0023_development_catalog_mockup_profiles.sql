-- Development catalog colors use the transparent white fixture with a deterministic tint.
-- Dedicated black, white, and navy photography remains unchanged.
WITH colors(color_code, tint_color) AS (
  VALUES
    ('ivory', '#fff7e7'), ('pepper', '#5f605b'), ('mustard', '#d0ae6e'),
    ('yam', '#c9814f'), ('grey', '#7a7f79'), ('moss', '#747f66'),
    ('light-green', '#738874'), ('chambray', '#d9edf5'), ('flo-blue', '#7682c2'),
    ('graphite', '#373231'), ('violet', '#a88fd7'), ('orchid', '#cbb3cc'),
    ('blossom', '#f8d1e2'), ('crunchberry', '#eb7ca2'), ('berry', '#775568'),
    ('watermelon', '#da807b'), ('bay', '#c3cfc1'), ('blue-jean', '#788ca1'),
    ('crimson', '#b66a74'), ('butter', '#f5e1a4'), ('chalky-mint', '#a7d9d4'),
    ('blue-spruce', '#536758'), ('brick', '#915c5c'), ('espresso', '#846b5b'),
    ('island-reef', '#a2d8c2'), ('lagoon-blue', '#89e4ed'), ('sapphire', '#03b2d3'),
    ('neon-pink', '#f57caf'), ('chili', '#853f44'), ('red', '#a80d27')
)
INSERT INTO app.garment_mockup_profiles (
  id, product_model_id, color_code, version, renderer_version, status, qualification,
  profile_data, development_only
)
SELECT
  'development-essential-tee-' || color_code || '-front-v1',
  'essential-dtg-tee', color_code, 'v1', 'sharp-garment-profile-v1', 'ACTIVE',
  'DEVELOPMENT / UNQUALIFIED',
  jsonb_build_object(
    'blankAsset', 'development-essential-tee-white-v1.png',
    'tintColor', tint_color,
    'placement', jsonb_build_object('x', 0.276, 'y', 0.285, 'width', 0.448, 'height', 0.34, 'rotation', 0),
    'mask', jsonb_build_object('cornerRadius', 0.035, 'inset', 0.015),
    'integration', jsonb_build_object('artworkOpacity', 0.97, 'shadingOpacity', 0.2, 'highlightOpacity', 0.06),
    'perspective', jsonb_build_object('enabled', false)
  ),
  true
FROM colors
ON CONFLICT (id) DO NOTHING;
