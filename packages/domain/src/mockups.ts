import { createHash } from 'node:crypto';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';
import {
  developmentProfileFor,
  mockupRendererName,
  mockupRendererVersion,
  SharpGarmentMockupRenderer,
  type GarmentMockupProfile,
} from '@let-it-be/mockups';
import type { PrivateObjectStorage } from '@let-it-be/storage';

export interface MockupSource {
  projectId: string;
  projectVersionId: string;
  prepressRunId: string;
  prepressPreviewAssetId: string;
  productModelId: string;
  colorCode: string;
}

export interface ConsumerMockup {
  id: string;
  previewAssetId: string;
  stateHash: string;
  profileId: string;
  profileVersion: string;
}

interface ProfileRow {
  id: string;
  version: string;
  renderer_version: string;
  development_only: boolean;
}

interface PreviewRow {
  storage_key: string;
  content_type: string;
}

interface MockupRow {
  id: string;
  preview_asset_id: string;
  state_hash: string;
  garment_profile_id: string;
  garment_profile_version: string;
}

/**
 * Creates only a consumer-safe, product-profile-rendered proof. It is separate
 * from prepress production rendering and deliberately consumes PREPRESS_PREVIEW,
 * never a Production Master or provider derivative.
 */
export class MockupService {
  private readonly renderer = new SharpGarmentMockupRenderer();

  public constructor(
    private readonly pool: SqlPool,
    private readonly storage: PrivateObjectStorage,
  ) {}

  async getOrCreate(source: MockupSource): Promise<ConsumerMockup> {
    const profile = await this.profile(source.productModelId, source.colorCode);
    const stateHash = mockupStateHash(source, profile);
    const existing = await this.existing(source, profile, stateHash);
    if (existing) return existing;

    const preview = await this.preview(source.prepressPreviewAssetId);
    const artwork = await this.storage.get(preview.storage_key);
    if (!artwork) throw new Error('The approved design preview is unavailable.');
    const rendered = await this.renderer.render({ profile, artwork: artwork.body });
    const storageKey = `mockups/${stateHash}/consumer-proof.png`;
    if (!(await this.storage.exists(storageKey))) {
      await this.storage.put({
        key: storageKey,
        body: rendered.png,
        contentType: 'image/png',
        metadata: {
          assetClass: 'consumer-mockup-proof',
          renderer: rendered.renderer,
          rendererVersion: rendered.rendererVersion,
          profileId: profile.id,
          profileVersion: profile.version,
          qualification: profile.qualification,
        },
      });
    }
    return withTransaction(this.pool, async (client) => {
      const repeat = await this.existing(source, profile, stateHash, client);
      if (repeat) return repeat;
      const proof = await client.query<{ id: string }>(
        `INSERT INTO app.assets (
           project_id, asset_type, storage_key, content_type, byte_size, width, height, source_asset_id
         ) VALUES ($1, 'MOCKUP_PROOF', $2, 'image/png', $3, $4, $5, $6)
         ON CONFLICT (storage_key) DO UPDATE SET storage_key = EXCLUDED.storage_key
         RETURNING id`,
        [
          source.projectId,
          storageKey,
          rendered.png.byteLength,
          rendered.width,
          rendered.height,
          source.prepressPreviewAssetId,
        ],
      );
      const previewAssetId = requireRow(proof.rows[0], 'Could not store the consumer proof.').id;
      const inserted = await client.query<MockupRow>(
        `INSERT INTO app.mockups (
           project_id, project_version_id, prepress_run_id, product_model_id, color_code, preview_asset_id,
           garment_profile_id, garment_profile_version, profile_snapshot, renderer, renderer_version, state_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
         RETURNING id, preview_asset_id, state_hash, garment_profile_id, garment_profile_version`,
        [
          source.projectId,
          source.projectVersionId,
          source.prepressRunId,
          source.productModelId,
          source.colorCode,
          previewAssetId,
          profile.id,
          profile.version,
          JSON.stringify(profile),
          rendered.renderer,
          rendered.rendererVersion,
          stateHash,
        ],
      );
      const row = requireRow(inserted.rows[0], 'Could not persist the consumer proof.');
      await client.query(
        `INSERT INTO app.asset_lineage (derived_asset_id, source_asset_id, relationship)
         VALUES ($1, $2, 'MOCKUP_ARTWORK_SOURCE') ON CONFLICT DO NOTHING`,
        [previewAssetId, source.prepressPreviewAssetId],
      );
      return map(row);
    });
  }

  private async profile(productModelId: string, colorCode: string): Promise<GarmentMockupProfile> {
    const expected = developmentProfileFor({ productModelId, colorCode });
    if (!expected)
      throw new Error('A mockup profile is not available for this selected shirt color.');
    const result = await this.pool.query<ProfileRow>(
      `SELECT id, version, renderer_version, development_only FROM app.garment_mockup_profiles
       WHERE id = $1 AND product_model_id = $2 AND color_code = $3 AND status = 'ACTIVE'`,
      [expected.id, productModelId, colorCode],
    );
    const persisted = requireRow(result.rows[0], 'The mockup profile is unavailable.');
    if (
      persisted.version !== expected.version ||
      persisted.renderer_version !== mockupRendererVersion ||
      !persisted.development_only
    ) {
      throw new Error('The configured mockup profile does not match its renderer.');
    }
    return expected;
  }

  private async preview(assetId: string): Promise<PreviewRow> {
    const result = await this.pool.query<PreviewRow>(
      `SELECT storage_key, content_type FROM app.assets
       WHERE id = $1 AND asset_type = 'PREPRESS_PREVIEW' AND status = 'ACTIVE'`,
      [assetId],
    );
    return requireRow(result.rows[0], 'The approved design preview is unavailable.');
  }

  private async existing(
    source: MockupSource,
    profile: GarmentMockupProfile,
    stateHash: string,
    client: SqlClient = this.pool,
  ): Promise<ConsumerMockup | null> {
    const result = await client.query<MockupRow>(
      `SELECT id, preview_asset_id, state_hash, garment_profile_id, garment_profile_version
       FROM app.mockups
       WHERE project_version_id = $1 AND prepress_run_id = $2 AND product_model_id = $3 AND color_code = $4
         AND garment_profile_id = $5 AND garment_profile_version = $6
         AND renderer = $7 AND renderer_version = $8 AND state_hash = $9`,
      [
        source.projectVersionId,
        source.prepressRunId,
        source.productModelId,
        source.colorCode,
        profile.id,
        profile.version,
        mockupRendererName,
        mockupRendererVersion,
        stateHash,
      ],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }
}

function mockupStateHash(source: MockupSource, profile: GarmentMockupProfile): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        projectId: source.projectId,
        projectVersionId: source.projectVersionId,
        prepressRunId: source.prepressRunId,
        prepressPreviewAssetId: source.prepressPreviewAssetId,
        productModelId: source.productModelId,
        colorCode: source.colorCode,
        profileId: profile.id,
        profileVersion: profile.version,
        renderer: mockupRendererName,
        rendererVersion: mockupRendererVersion,
      }),
    )
    .digest('hex');
}

function map(row: MockupRow): ConsumerMockup {
  return {
    id: row.id,
    previewAssetId: row.preview_asset_id,
    stateHash: row.state_hash,
    profileId: row.garment_profile_id,
    profileVersion: row.garment_profile_version,
  };
}

function requireRow<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message);
  return value;
}
