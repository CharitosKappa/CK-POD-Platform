import { randomUUID } from 'node:crypto';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';
import type { PrivateObjectStorage } from '@let-it-be/storage';

import type { GenerationValidationService } from './ai-contracts';
import type { ActiveSession } from './identity';
import { DefaultProviderOutputValidation } from './provider-output-validation';
import { ProjectConflictError } from './projects';

export interface ReferenceImageAsset {
  id: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
}

export interface ReplaceReferenceImageInput {
  expectedRevision: number;
  body: Uint8Array;
  contentType: string;
  width: number;
  height: number;
}

export interface ReferenceImageMutation {
  projectRevision: number;
  referenceAssetIds: string[];
  asset: ReferenceImageAsset | null;
}

export class ReferenceAssetValidationError extends Error {}

/**
 * Owns private reference-image persistence. Object keys remain server-only and
 * database ownership is rechecked for every mutation.
 */
export class ReferenceAssetService {
  public constructor(
    private readonly pool: SqlPool,
    private readonly storage: PrivateObjectStorage,
    private readonly maxReferenceAssets = 5,
    private readonly validation: GenerationValidationService = new DefaultProviderOutputValidation(),
  ) {}

  async replace(
    session: ActiveSession,
    projectId: string,
    input: ReplaceReferenceImageInput,
  ): Promise<ReferenceImageMutation> {
    if (this.maxReferenceAssets < 1) {
      throw new ReferenceAssetValidationError('Reference images are not currently available.');
    }
    const verdict = await this.validation.validate({
      body: input.body,
      contentType: input.contentType,
      width: input.width,
      height: input.height,
      productContext: {
        productModelId: 'reference-upload',
        productDisplayName: 'Reference upload',
        colorCode: 'not-applicable',
        colorName: 'Not applicable',
        printArea: {},
      },
    });
    if (!verdict.accepted) {
      throw new ReferenceAssetValidationError(
        verdict.reason ?? 'That image could not be used as a reference.',
      );
    }

    const assetId = randomUUID();
    const storageKey = `projects/${projectId}/references/${assetId}.png`;
    await this.storage.put({
      key: storageKey,
      body: input.body,
      contentType: input.contentType,
      metadata: { purpose: 'reference-image', projectId },
    });

    let replacedKeys: string[] = [];
    try {
      const mutation = await withTransaction(this.pool, async (client) => {
        await this.requireRevision(client, session, projectId, input.expectedRevision);
        const draft = await this.lockDraft(client, projectId);
        const priorIds = stringArray(draft.reference_asset_ids);
        if (priorIds.length) {
          const prior = await client.query<{ storage_key: string }>(
            `UPDATE app.assets
             SET status = 'DELETED'
             WHERE project_id = $1 AND id = ANY($2::uuid[])
               AND asset_type = 'REFERENCE' AND status = 'ACTIVE'
             RETURNING storage_key`,
            [projectId, priorIds],
          );
          replacedKeys = prior.rows.map((row) => row.storage_key);
        }
        await client.query(
          `INSERT INTO app.assets (
             id, project_id, asset_type, storage_key, content_type, byte_size, width, height
           ) VALUES ($1, $2, 'REFERENCE', $3, $4, $5, $6, $7)`,
          [
            assetId,
            projectId,
            storageKey,
            input.contentType,
            input.body.byteLength,
            input.width,
            input.height,
          ],
        );
        await client.query(
          `UPDATE app.project_creation_drafts
           SET reference_asset_ids = $2::jsonb, updated_at = now()
           WHERE project_id = $1`,
          [projectId, JSON.stringify([assetId])],
        );
        const revision = await incrementRevision(client, projectId, input.expectedRevision);
        return {
          projectRevision: revision,
          referenceAssetIds: [assetId],
          asset: {
            id: assetId,
            contentType: input.contentType,
            byteSize: input.body.byteLength,
            width: input.width,
            height: input.height,
          },
        } satisfies ReferenceImageMutation;
      });
      await Promise.allSettled(replacedKeys.map((key) => this.storage.delete(key)));
      return mutation;
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async remove(
    session: ActiveSession,
    projectId: string,
    assetId: string,
    expectedRevision: number,
  ): Promise<ReferenceImageMutation> {
    let storageKey: string | null = null;
    const mutation = await withTransaction(this.pool, async (client) => {
      await this.requireRevision(client, session, projectId, expectedRevision);
      const draft = await this.lockDraft(client, projectId);
      if (!stringArray(draft.reference_asset_ids).includes(assetId)) {
        throw new ReferenceAssetValidationError('Reference image not found.');
      }
      const removed = await client.query<{ storage_key: string }>(
        `UPDATE app.assets
         SET status = 'DELETED'
         WHERE id = $1 AND project_id = $2 AND asset_type = 'REFERENCE' AND status = 'ACTIVE'
         RETURNING storage_key`,
        [assetId, projectId],
      );
      storageKey = removed.rows[0]?.storage_key ?? null;
      if (!storageKey) throw new ReferenceAssetValidationError('Reference image not found.');
      await client.query(
        `UPDATE app.project_creation_drafts
         SET reference_asset_ids = '[]'::jsonb, updated_at = now()
         WHERE project_id = $1`,
        [projectId],
      );
      const revision = await incrementRevision(client, projectId, expectedRevision);
      return { projectRevision: revision, referenceAssetIds: [], asset: null };
    });
    if (storageKey) await this.storage.delete(storageKey).catch(() => undefined);
    return mutation;
  }

  private async requireRevision(
    client: SqlClient,
    session: ActiveSession,
    projectId: string,
    expectedRevision: number,
  ): Promise<void> {
    const project = await client.query<{ revision: number }>(
      `SELECT revision FROM app.projects
       WHERE id = $1 AND ((owner_type = 'GUEST' AND owner_session_id = $2)
         OR (owner_type = 'USER' AND owner_user_id = $3::uuid))
       FOR UPDATE`,
      [projectId, session.id, session.userId],
    );
    if (!project.rows[0]) throw new Error('Project not found.');
    if (project.rows[0].revision !== expectedRevision) {
      throw new ProjectConflictError('Project changed before this reference image could be saved.');
    }
  }

  private async lockDraft(
    client: SqlClient,
    projectId: string,
  ): Promise<{ reference_asset_ids: unknown }> {
    const draft = await client.query<{ reference_asset_ids: unknown }>(
      `SELECT reference_asset_ids FROM app.project_creation_drafts
       WHERE project_id = $1 FOR UPDATE`,
      [projectId],
    );
    const row = draft.rows[0];
    if (!row) throw new Error('Project draft not found.');
    return row;
  }
}

async function incrementRevision(
  client: SqlClient,
  projectId: string,
  expectedRevision: number,
): Promise<number> {
  const updated = await client.query<{ revision: number }>(
    `UPDATE app.projects SET revision = revision + 1, updated_at = now()
     WHERE id = $1 AND revision = $2 RETURNING revision`,
    [projectId, expectedRevision],
  );
  const revision = updated.rows[0]?.revision;
  if (revision === undefined) {
    throw new ProjectConflictError('Project changed before this reference image could be saved.');
  }
  return revision;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
