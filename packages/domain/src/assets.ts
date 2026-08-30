import type { SqlPool } from '@let-it-be/db';

import type { ActiveSession } from './identity';

export interface ControlledPreviewAsset {
  storageKey: string;
  contentType: string;
}

/** Resolves a preview for server-side delivery only. Storage keys never leave this domain boundary. */
export class AssetService {
  public constructor(private readonly pool: SqlPool) {}

  async getControlledPreview(
    session: ActiveSession,
    projectId: string,
    assetId: string,
  ): Promise<ControlledPreviewAsset | null> {
    const result = await this.pool.query<ControlledPreviewAsset>(
      `SELECT a.storage_key AS "storageKey", a.content_type AS "contentType"
       FROM app.assets a
       JOIN app.projects p ON p.id = a.project_id
       WHERE a.id = $1 AND a.project_id = $2 AND a.asset_type IN ('PREVIEW', 'PREPRESS_PREVIEW', 'MOCKUP_PROOF') AND a.status = 'ACTIVE'
         AND ((p.owner_type = 'GUEST' AND p.owner_session_id = $3)
           OR (p.owner_type = 'USER' AND p.owner_user_id = $4::uuid))`,
      [assetId, projectId, session.id, session.userId],
    );
    return result.rows[0] ?? null;
  }
}
