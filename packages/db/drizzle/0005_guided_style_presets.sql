--> statement-breakpoint
CREATE TABLE app.style_families (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text NOT NULL,
  display_order integer NOT NULL CHECK (display_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  visual_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX style_families_display_order_idx ON app.style_families(display_order);
--> statement-breakpoint
CREATE TABLE app.style_presets (
  id text PRIMARY KEY,
  style_family_id text NOT NULL REFERENCES app.style_families(id) ON DELETE RESTRICT,
  slug text NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL,
  display_order integer NOT NULL CHECK (display_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  visual_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (style_family_id, slug),
  UNIQUE (id, style_family_id)
);
--> statement-breakpoint
CREATE INDEX style_presets_family_order_idx
  ON app.style_presets(style_family_id, display_order) WHERE is_active;
--> statement-breakpoint
CREATE TABLE app.style_preset_versions (
  preset_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  style_family_id text NOT NULL,
  configuration jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (preset_id, version),
  UNIQUE (style_family_id, preset_id, version),
  FOREIGN KEY (preset_id, style_family_id)
    REFERENCES app.style_presets(id, style_family_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.prevent_style_preset_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Style preset versions are append-only; create a new version instead.';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER style_preset_versions_immutable
  BEFORE UPDATE OR DELETE ON app.style_preset_versions
  FOR EACH ROW EXECUTE FUNCTION app.prevent_style_preset_version_mutation();
--> statement-breakpoint
ALTER TABLE app.projects
  ADD COLUMN style_selection_mode text NOT NULL DEFAULT 'AUTO'
    CHECK (style_selection_mode IN ('MANUAL', 'AUTO')),
  ADD COLUMN style_family_id text,
  ADD COLUMN style_preset_id text,
  ADD COLUMN style_preset_version integer;
--> statement-breakpoint
ALTER TABLE app.projects
  ADD CONSTRAINT projects_style_selection_shape_check CHECK (
    (style_family_id IS NULL AND style_preset_id IS NULL AND style_preset_version IS NULL)
    OR (style_family_id IS NOT NULL AND style_preset_id IS NOT NULL AND style_preset_version IS NOT NULL)
  ),
  ADD CONSTRAINT projects_style_selection_fk FOREIGN KEY (
    style_family_id, style_preset_id, style_preset_version
  ) REFERENCES app.style_preset_versions(style_family_id, preset_id, version) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE app.generations
  ADD COLUMN style_selection_mode text NOT NULL DEFAULT 'AUTO'
    CHECK (style_selection_mode IN ('MANUAL', 'AUTO')),
  ADD COLUMN style_family_id text,
  ADD COLUMN style_preset_id text,
  ADD COLUMN style_preset_version integer;
--> statement-breakpoint
ALTER TABLE app.generations
  ADD CONSTRAINT generations_style_selection_shape_check CHECK (
    (style_family_id IS NULL AND style_preset_id IS NULL AND style_preset_version IS NULL)
    OR (style_family_id IS NOT NULL AND style_preset_id IS NOT NULL AND style_preset_version IS NOT NULL)
  ),
  ADD CONSTRAINT generations_style_selection_fk FOREIGN KEY (
    style_family_id, style_preset_id, style_preset_version
  ) REFERENCES app.style_preset_versions(style_family_id, preset_id, version) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX generations_style_attribution_idx
  ON app.generations(style_family_id, style_preset_id, style_preset_version, created_at DESC);
--> statement-breakpoint
INSERT INTO app.style_families (
  id, slug, display_name, description, display_order, visual_metadata, config_metadata
) VALUES
  ('family-vintage', 'vintage', 'Vintage', 'Classic character with a lived-in feel.', 10, '{"accent":"#d17a4b","accentSecondary":"#f2cf91","previewKind":"development-gradient"}', '{"catalog":"development"}'),
  ('family-dark', 'dark', 'Dark', 'Bold, moody artwork with high-impact contrast.', 20, '{"accent":"#3b284f","accentSecondary":"#b64d69","previewKind":"development-gradient"}', '{"catalog":"development"}'),
  ('family-illustration', 'illustration', 'Illustration', 'Expressive art with a hand-made energy.', 30, '{"accent":"#4c83c3","accentSecondary":"#f6c758","previewKind":"development-gradient"}', '{"catalog":"development"}'),
  ('family-minimal', 'minimal', 'Minimal', 'Clean, focused artwork that says more with less.', 40, '{"accent":"#2f6f63","accentSecondary":"#d9eadb","previewKind":"development-gradient"}', '{"catalog":"development"}'),
  ('family-typography', 'typography', 'Typography', 'Words with personality, made to be worn.', 50, '{"accent":"#9e4f2a","accentSecondary":"#f0b15f","previewKind":"development-gradient"}', '{"catalog":"development"}');
--> statement-breakpoint
INSERT INTO app.style_presets (
  id, style_family_id, slug, display_name, description, display_order, visual_metadata
) VALUES
  ('preset-vintage-70s-retro', 'family-vintage', '70s-retro', '70s Retro', 'Warm curves and optimistic throwback energy.', 10, '{"accent":"#ed9b4e","accentSecondary":"#75523c","previewKind":"development-gradient"}'),
  ('preset-vintage-distressed', 'family-vintage', 'distressed', 'Distressed', 'Worn-in character with an imperfect finish.', 20, '{"accent":"#b96f4e","accentSecondary":"#40352d","previewKind":"development-gradient"}'),
  ('preset-vintage-engraving', 'family-vintage', 'vintage-engraving', 'Vintage Engraving', 'Classic etched detail with a heritage feel.', 30, '{"accent":"#856b4b","accentSecondary":"#dfc48b","previewKind":"development-gradient"}'),
  ('preset-vintage-heritage-badge', 'family-vintage', 'heritage-badge', 'Heritage Badge', 'A confident emblem built around your idea.', 40, '{"accent":"#b54f3e","accentSecondary":"#f4d37c","previewKind":"development-gradient"}'),
  ('preset-dark-gothic', 'family-dark', 'gothic', 'Gothic', 'Dramatic forms with a striking, moody edge.', 10, '{"accent":"#272135","accentSecondary":"#c06a83","previewKind":"development-gradient"}'),
  ('preset-dark-woodcut', 'family-dark', 'woodcut', 'Woodcut', 'High-contrast carved marks and shadow.', 20, '{"accent":"#2b2835","accentSecondary":"#dbb873","previewKind":"development-gradient"}'),
  ('preset-dark-engraving', 'family-dark', 'dark-engraving', 'Dark Engraving', 'Fine dramatic linework with depth.', 30, '{"accent":"#3c3048","accentSecondary":"#8c6587","previewKind":"development-gradient"}'),
  ('preset-dark-blackwork', 'family-dark', 'blackwork', 'Blackwork', 'Bold ink-inspired shapes with clean contrast.', 40, '{"accent":"#181a22","accentSecondary":"#d9d3cc","previewKind":"development-gradient"}'),
  ('preset-illustration-bold-cartoon', 'family-illustration', 'bold-cartoon', 'Bold Cartoon', 'Playful shapes with a big personality.', 10, '{"accent":"#ea7051","accentSecondary":"#ffd468","previewKind":"development-gradient"}'),
  ('preset-illustration-comic', 'family-illustration', 'comic', 'Comic', 'Dynamic storytelling with punchy energy.', 20, '{"accent":"#4874b6","accentSecondary":"#efc057","previewKind":"development-gradient"}'),
  ('preset-illustration-hand-drawn', 'family-illustration', 'hand-drawn', 'Hand Drawn', 'Loose, human marks that feel personal.', 30, '{"accent":"#609c91","accentSecondary":"#e9c8ab","previewKind":"development-gradient"}'),
  ('preset-illustration-mascot', 'family-illustration', 'mascot', 'Mascot', 'A character-forward look made for a tee.', 40, '{"accent":"#6a69b9","accentSecondary":"#f3ae59","previewKind":"development-gradient"}'),
  ('preset-minimal-line-art', 'family-minimal', 'line-art', 'Line Art', 'One clear idea, drawn with restraint.', 10, '{"accent":"#254b47","accentSecondary":"#d9e9e3","previewKind":"development-gradient"}'),
  ('preset-minimal-clean-typography', 'family-minimal', 'clean-typography', 'Clean Typography', 'Simple type-led composition with room to breathe.', 20, '{"accent":"#407266","accentSecondary":"#e9e5dd","previewKind":"development-gradient"}'),
  ('preset-minimal-icon', 'family-minimal', 'minimal-icon', 'Minimal Icon', 'A small symbol with a strong point of view.', 30, '{"accent":"#4b766e","accentSecondary":"#bcd7cf","previewKind":"development-gradient"}'),
  ('preset-minimal-modern-badge', 'family-minimal', 'modern-badge', 'Modern Badge', 'A tidy emblem with contemporary polish.', 40, '{"accent":"#47655d","accentSecondary":"#d4b37a","previewKind":"development-gradient"}'),
  ('preset-type-retro', 'family-typography', 'retro-type', 'Retro Type', 'Throwback lettering that carries the message.', 10, '{"accent":"#bc6238","accentSecondary":"#f1c464","previewKind":"development-gradient"}'),
  ('preset-type-college', 'family-typography', 'college', 'College', 'Confident athletic-inspired lettering.', 20, '{"accent":"#8c422f","accentSecondary":"#e7d3a5","previewKind":"development-gradient"}'),
  ('preset-type-bold-statement', 'family-typography', 'bold-statement', 'Bold Statement', 'Big words, clear message, instant impact.', 30, '{"accent":"#a64c2b","accentSecondary":"#f19c63","previewKind":"development-gradient"}'),
  ('preset-type-hand-lettered', 'family-typography', 'hand-lettered', 'Hand Lettered', 'Expressive lettering with a personal touch.', 40, '{"accent":"#9a573e","accentSecondary":"#ebbd87","previewKind":"development-gradient"}');
--> statement-breakpoint
INSERT INTO app.style_preset_versions (preset_id, version, style_family_id, configuration)
SELECT
  p.id,
  1,
  p.style_family_id,
  jsonb_build_object(
    'promptConditioning', jsonb_build_object('family', f.display_name, 'substyle', p.display_name, 'direction', p.description),
    'compositionGuidance', jsonb_build_object('focus', 'single wearable focal point', 'layout', 'balanced front print'),
    'typographyGuidance', jsonb_build_object('mood', p.display_name, 'exactTextIsDeterministic', true),
    'colorStrategy', jsonb_build_object('considerShirtColor', true, 'avoidLowContrast', true),
    'textureDetailGuidance', jsonb_build_object('detailLevel', 'print-friendly', 'style', p.slug),
    'printGuidance', jsonb_build_object('transparentBackgroundPreferred', true, 'avoidTinyDetails', true),
    'negativeGuidance', jsonb_build_array('unintended readable text', 'photographic product mockup'),
    'routingHints', jsonb_build_object('task', 'TEXT_TO_ARTWORK')
  )
FROM app.style_presets p
JOIN app.style_families f ON f.id = p.style_family_id;
