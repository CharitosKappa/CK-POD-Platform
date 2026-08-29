import { createHash } from 'node:crypto';

import type { SqlClient } from '@let-it-be/db';

export type StyleSelectionMode = 'MANUAL' | 'AUTO';

export interface StyleVisualMetadata {
  accent: string;
  accentSecondary: string;
  previewKind: 'development-gradient';
}

export interface StylePresetConfiguration {
  promptConditioning: {
    family: string;
    substyle: string;
    direction: string;
  };
  compositionGuidance: {
    focus: string;
    layout: string;
  };
  typographyGuidance: {
    mood: string;
    exactTextIsDeterministic: boolean;
  };
  colorStrategy: {
    considerShirtColor: boolean;
    avoidLowContrast: boolean;
  };
  textureDetailGuidance: {
    detailLevel: string;
    style: string;
  };
  printGuidance: {
    transparentBackgroundPreferred: boolean;
    avoidTinyDetails: boolean;
  };
  negativeGuidance: string[];
  routingHints: {
    task: 'TEXT_TO_ARTWORK';
  };
}

export interface StyleSelection {
  selectionMode: StyleSelectionMode;
  styleFamilyId: string | null;
  presetId: string | null;
  presetVersion: number | null;
}

export interface PublicStylePreset {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  displayOrder: number;
  version: number;
  visual: StyleVisualMetadata;
}

export interface PublicStyleFamily {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  displayOrder: number;
  visual: StyleVisualMetadata;
  presets: PublicStylePreset[];
}

export interface ResolvedStyleSelection extends StyleSelection {
  styleFamily: {
    id: string;
    displayName: string;
  };
  preset: {
    id: string;
    displayName: string;
    version: number;
  };
  conditioning: StylePresetConfiguration;
}

export interface ManualStyleSelectionInput {
  styleFamilyId: string;
  presetId: string;
}

interface PublicStyleRow {
  family_id: string;
  family_slug: string;
  family_display_name: string;
  family_description: string;
  family_display_order: number;
  family_visual_metadata: unknown;
  preset_id: string;
  preset_slug: string;
  preset_display_name: string;
  preset_description: string;
  preset_display_order: number;
  preset_visual_metadata: unknown;
  preset_version: number;
}

interface ResolvedStyleRow {
  family_id: string;
  family_display_name: string;
  preset_id: string;
  preset_display_name: string;
  version: number;
  configuration: unknown;
}

/**
 * Owns catalog display data and server-only resolution of immutable preset versions.
 * Consumers never receive conditioning, negative guidance, or routing hints.
 */
export class StyleCatalogService {
  public constructor(private readonly db: SqlClient) {}

  async listActive(): Promise<PublicStyleFamily[]> {
    const result = await this.db.query<PublicStyleRow>(publicCatalogQuery());
    return mapPublicCatalog(result.rows);
  }

  async resolveManual(input: ManualStyleSelectionInput): Promise<ResolvedStyleSelection> {
    return resolveManualSelection(this.db, input, true);
  }
}

export async function resolvePersistedStyleSelection(
  client: SqlClient,
  selection: StyleSelection,
  context: { projectId: string; rawPrompt: string },
): Promise<ResolvedStyleSelection> {
  if (selection.selectionMode === 'MANUAL') {
    if (!selection.styleFamilyId || !selection.presetId) {
      throw new Error('Choose a style before generating.');
    }
    return resolveManualSelection(
      client,
      { styleFamilyId: selection.styleFamilyId, presetId: selection.presetId },
      false,
      selection.presetVersion,
    );
  }

  if (selection.styleFamilyId && selection.presetId && selection.presetVersion) {
    return resolveManualSelection(
      client,
      { styleFamilyId: selection.styleFamilyId, presetId: selection.presetId },
      false,
      selection.presetVersion,
      'AUTO',
    );
  }

  const candidates = await client.query<ResolvedStyleRow>(
    `${resolvedStyleQuery()}
     WHERE f.is_active AND p.is_active
     ORDER BY f.display_order, p.display_order, v.version`,
  );
  if (!candidates.rows.length) throw new Error('Style choices are temporarily unavailable.');
  const digest = createHash('sha256')
    .update(`${context.projectId}:${context.rawPrompt.trim().toLowerCase()}`)
    .digest();
  const row = candidates.rows[digest.readUInt32BE(0) % candidates.rows.length];
  if (!row) throw new Error('Style choices are temporarily unavailable.');
  return mapResolvedStyle(row, 'AUTO');
}

async function resolveManualSelection(
  client: SqlClient,
  input: ManualStyleSelectionInput,
  activeOnly: boolean,
  version?: number | null,
  selectionMode: StyleSelectionMode = 'MANUAL',
): Promise<ResolvedStyleSelection> {
  const result = await client.query<ResolvedStyleRow>(
    `${resolvedStyleQuery()}
     WHERE f.id = $1 AND p.id = $2
       ${version ? 'AND v.version = $3' : ''}
       ${activeOnly ? 'AND f.is_active AND p.is_active' : ''}
     ORDER BY v.version DESC
     LIMIT 1`,
    version
      ? [input.styleFamilyId, input.presetId, version]
      : [input.styleFamilyId, input.presetId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('That style choice is unavailable.');
  return mapResolvedStyle(row, selectionMode);
}

function publicCatalogQuery(): string {
  return `SELECT f.id AS family_id, f.slug AS family_slug, f.display_name AS family_display_name,
      f.description AS family_description, f.display_order AS family_display_order,
      f.visual_metadata AS family_visual_metadata, p.id AS preset_id, p.slug AS preset_slug,
      p.display_name AS preset_display_name, p.description AS preset_description,
      p.display_order AS preset_display_order, p.visual_metadata AS preset_visual_metadata,
      latest.version AS preset_version
    FROM app.style_families f
    JOIN app.style_presets p ON p.style_family_id = f.id
    JOIN LATERAL (
      SELECT version FROM app.style_preset_versions
      WHERE preset_id = p.id ORDER BY version DESC LIMIT 1
    ) latest ON true
    WHERE f.is_active AND p.is_active
    ORDER BY f.display_order, p.display_order`;
}

function resolvedStyleQuery(): string {
  return `SELECT f.id AS family_id, f.display_name AS family_display_name,
      p.id AS preset_id, p.display_name AS preset_display_name, v.version, v.configuration
    FROM app.style_families f
    JOIN app.style_presets p ON p.style_family_id = f.id
    JOIN app.style_preset_versions v ON v.preset_id = p.id AND v.style_family_id = f.id`;
}

function mapPublicCatalog(rows: PublicStyleRow[]): PublicStyleFamily[] {
  const families = new Map<string, PublicStyleFamily>();
  for (const row of rows) {
    const family = families.get(row.family_id) ?? {
      id: row.family_id,
      slug: row.family_slug,
      displayName: row.family_display_name,
      description: row.family_description,
      displayOrder: row.family_display_order,
      visual: visualMetadata(row.family_visual_metadata),
      presets: [],
    };
    family.presets.push({
      id: row.preset_id,
      slug: row.preset_slug,
      displayName: row.preset_display_name,
      description: row.preset_description,
      displayOrder: row.preset_display_order,
      version: row.preset_version,
      visual: visualMetadata(row.preset_visual_metadata),
    });
    families.set(row.family_id, family);
  }
  return [...families.values()];
}

function mapResolvedStyle(
  row: ResolvedStyleRow,
  selectionMode: StyleSelectionMode,
): ResolvedStyleSelection {
  return {
    selectionMode,
    styleFamilyId: row.family_id,
    presetId: row.preset_id,
    presetVersion: row.version,
    styleFamily: { id: row.family_id, displayName: row.family_display_name },
    preset: { id: row.preset_id, displayName: row.preset_display_name, version: row.version },
    conditioning: configuration(row.configuration),
  };
}

function visualMetadata(value: unknown): StyleVisualMetadata {
  const metadata = value as Partial<StyleVisualMetadata> | null;
  if (
    !metadata ||
    typeof metadata.accent !== 'string' ||
    typeof metadata.accentSecondary !== 'string' ||
    metadata.previewKind !== 'development-gradient'
  ) {
    throw new Error('Style visual metadata is invalid.');
  }
  return metadata as StyleVisualMetadata;
}

function configuration(value: unknown): StylePresetConfiguration {
  const config = value as Partial<StylePresetConfiguration> | null;
  if (
    !config ||
    !config.promptConditioning ||
    !config.compositionGuidance ||
    !config.typographyGuidance ||
    !config.colorStrategy ||
    !config.textureDetailGuidance ||
    !config.printGuidance ||
    !Array.isArray(config.negativeGuidance) ||
    !config.routingHints
  ) {
    throw new Error('Style preset configuration is invalid.');
  }
  return config as StylePresetConfiguration;
}
