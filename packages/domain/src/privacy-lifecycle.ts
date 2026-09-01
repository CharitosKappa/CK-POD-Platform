import { createHash } from 'node:crypto';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';
import type { PrivateObjectStorage } from '@let-it-be/storage';

export type RetentionDisposition =
  'ELIGIBLE_FOR_DELETION' | 'RETENTION_REQUIRED' | 'EXTERNALLY_CONFIGURED' | 'LEGAL_OR_AUDIT_HOLD';

export interface PrivacyDataInventory {
  guestSessions: RetentionDisposition;
  accountProfile: RetentionDisposition;
  unfinishedProjects: RetentionDisposition;
  purchasedProjectsAndArtwork: RetentionDisposition;
  financialRecords: RetentionDisposition;
  fulfillmentRecords: RetentionDisposition;
  policyAndAuditRecords: RetentionDisposition;
  lifecycleRecords: RetentionDisposition;
  analyticsEvents: RetentionDisposition;
  privateAssets: RetentionDisposition;
}

export interface PrivacySubjectReport {
  userId: string;
  retentionHold: boolean;
  inventory: PrivacyDataInventory;
  counts: {
    sessions: number;
    unfinishedProjectsEligible: number;
    purchasedProjectsProtected: number;
    financialRecordsProtected: number;
    fulfillmentRecordsProtected: number;
    policyAndAuditRecordsProtected: number;
    lifecycleRecords: number;
    analyticsEvents: number;
    privateAssetsEligible: number;
  };
  eligibleUnfinishedProjectIds: string[];
  eligiblePrivateAssetIds: string[];
}

export interface PrivacyActionResult {
  userId: string;
  action: 'ACCOUNT_ANONYMIZED' | 'MARKETING_SUPPRESSED' | 'UNFINISHED_PROJECT_DELETED';
  status: 'COMPLETED' | 'BLOCKED' | 'DRY_RUN';
  details: Record<string, unknown>;
}

interface CountRow {
  count: string;
}

interface EligibleProjectRow {
  id: string;
}

interface AssetRow {
  id: string;
  storage_key: string;
}

interface UserRow {
  id: string;
  email: string;
  retention_hold: boolean;
}

/**
 * Technical privacy lifecycle boundary. It deliberately does not invent legal
 * retention periods: protected records remain retained until counsel-approved
 * policy/configuration authorises a later action.
 */
export class PrivacyLifecycleService {
  public constructor(private readonly pool: SqlPool) {}

  async inspectUser(userId: string, now = new Date()): Promise<PrivacySubjectReport> {
    const [
      control,
      sessions,
      eligibleProjects,
      purchasedProjects,
      financial,
      fulfillment,
      audit,
      lifecycle,
      analytics,
    ] = await Promise.all([
      this.pool.query<{ retention_hold: boolean }>(
        `SELECT retention_hold FROM app.privacy_subject_controls WHERE user_id = $1`,
        [userId],
      ),
      count(this.pool, `SELECT count(*)::text AS count FROM app.sessions WHERE user_id = $1`, [
        userId,
      ]),
      this.eligibleProjects(this.pool, userId, now),
      count(
        this.pool,
        `SELECT count(DISTINCT p.id)::text AS count FROM app.projects p
           JOIN app.order_items i ON i.project_id = p.id WHERE p.owner_user_id = $1`,
        [userId],
      ),
      count(this.pool, `SELECT count(*)::text AS count FROM app.orders WHERE owner_user_id = $1`, [
        userId,
      ]),
      count(
        this.pool,
        `SELECT count(*)::text AS count FROM app.external_fulfillment_orders e
           JOIN app.orders o ON o.id = e.order_id WHERE o.owner_user_id = $1`,
        [userId],
      ),
      count(
        this.pool,
        `SELECT count(*)::text AS count FROM app.order_operational_audits a
           JOIN app.orders o ON o.id = a.order_id WHERE o.owner_user_id = $1`,
        [userId],
      ),
      count(
        this.pool,
        `SELECT count(*)::text AS count FROM app.lifecycle_deliveries l
           JOIN app.users u ON u.id = $1 WHERE l.recipient_email = u.email`,
        [userId],
      ),
      count(
        this.pool,
        `SELECT count(*)::text AS count FROM app.analytics_events
           WHERE dimensions->>'userId' = $1`,
        [userId],
      ),
    ]);
    const assetRows = await this.assetsForProjects(eligibleProjects.map((project) => project.id));
    const hold = control.rows[0]?.retention_hold ?? false;

    return {
      userId,
      retentionHold: hold,
      inventory: {
        guestSessions: 'ELIGIBLE_FOR_DELETION',
        accountProfile: hold ? 'LEGAL_OR_AUDIT_HOLD' : 'ELIGIBLE_FOR_DELETION',
        unfinishedProjects: hold ? 'LEGAL_OR_AUDIT_HOLD' : 'ELIGIBLE_FOR_DELETION',
        purchasedProjectsAndArtwork: 'RETENTION_REQUIRED',
        financialRecords: 'EXTERNALLY_CONFIGURED',
        fulfillmentRecords: 'EXTERNALLY_CONFIGURED',
        policyAndAuditRecords: 'LEGAL_OR_AUDIT_HOLD',
        lifecycleRecords: hold ? 'LEGAL_OR_AUDIT_HOLD' : 'ELIGIBLE_FOR_DELETION',
        analyticsEvents: 'RETENTION_REQUIRED',
        privateAssets: hold ? 'LEGAL_OR_AUDIT_HOLD' : 'ELIGIBLE_FOR_DELETION',
      },
      counts: {
        sessions,
        unfinishedProjectsEligible: hold ? 0 : eligibleProjects.length,
        purchasedProjectsProtected: purchasedProjects,
        financialRecordsProtected: financial,
        fulfillmentRecordsProtected: fulfillment,
        policyAndAuditRecordsProtected: audit,
        lifecycleRecords: lifecycle,
        analyticsEvents: analytics,
        privateAssetsEligible: hold ? 0 : assetRows.length,
      },
      eligibleUnfinishedProjectIds: hold ? [] : eligibleProjects.map((project) => project.id),
      eligiblePrivateAssetIds: hold ? [] : assetRows.map((asset) => asset.id),
    };
  }

  async suppressMarketing(
    userId: string,
    reasonCode = 'PRIVACY_REQUEST',
  ): Promise<PrivacyActionResult> {
    return withTransaction(this.pool, async (client) => {
      const user = await this.lockUser(client, userId);
      const emailHash = hashIdentifier(user.email);
      await client.query(
        `INSERT INTO app.privacy_subject_controls (user_id, marketing_identifier_hash, marketing_suppressed_at, updated_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (user_id) DO UPDATE SET marketing_identifier_hash = EXCLUDED.marketing_identifier_hash,
           marketing_suppressed_at = now(), updated_at = now()`,
        [userId, emailHash],
      );
      const suppressed = await client.query(
        `UPDATE app.lifecycle_deliveries SET status = 'SUPPRESSED', updated_at = now()
         WHERE recipient_email = $1 AND classification = 'MARKETING'
           AND status IN ('PENDING', 'RETRYING')`,
        [user.email],
      );
      const details = { suppressedPendingDeliveries: suppressed.rowCount ?? 0 };
      await this.recordAction(
        client,
        userId,
        'MARKETING_SUPPRESSED',
        'COMPLETED',
        reasonCode,
        details,
      );
      return { userId, action: 'MARKETING_SUPPRESSED', status: 'COMPLETED', details };
    });
  }

  async anonymizeAccount(
    userId: string,
    reasonCode = 'PRIVACY_REQUEST',
  ): Promise<PrivacyActionResult> {
    return withTransaction(this.pool, async (client) => {
      const user = await this.lockUser(client, userId);
      const control = await client.query<{ retention_hold: boolean }>(
        `SELECT retention_hold FROM app.privacy_subject_controls WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );
      if (control.rows[0]?.retention_hold) {
        const details = { reason: 'retention-hold' };
        await this.recordAction(
          client,
          userId,
          'ACCOUNT_ANONYMIZED',
          'BLOCKED',
          reasonCode,
          details,
        );
        return { userId, action: 'ACCOUNT_ANONYMIZED', status: 'BLOCKED', details };
      }

      const emailHash = hashIdentifier(user.email);
      const pseudonym = `deleted+${userId}@redacted.invalid`;
      await client.query(
        `INSERT INTO app.privacy_subject_controls (user_id, marketing_identifier_hash, marketing_suppressed_at, anonymized_at, updated_at)
         VALUES ($1, $2, now(), now(), now())
         ON CONFLICT (user_id) DO UPDATE SET marketing_identifier_hash = EXCLUDED.marketing_identifier_hash,
           marketing_suppressed_at = coalesce(app.privacy_subject_controls.marketing_suppressed_at, now()),
           anonymized_at = now(), updated_at = now()`,
        [userId, emailHash],
      );
      const lifecycle = await client.query(
        `UPDATE app.lifecycle_deliveries SET recipient_email = $2, payload = '{}'::jsonb,
           status = CASE WHEN classification = 'MARKETING' AND status IN ('PENDING', 'RETRYING')
             THEN 'SUPPRESSED' ELSE status END, updated_at = now()
         WHERE recipient_email = $1`,
        [user.email, pseudonym],
      );
      await client.query(
        `UPDATE app.customer_notes SET customer_email = $2 WHERE customer_email = $1`,
        [user.email, pseudonym],
      );
      const sessions = await client.query(`DELETE FROM app.sessions WHERE user_id = $1`, [userId]);
      await client.query(
        `UPDATE app.users SET email = $2, password_hash = $3, updated_at = now() WHERE id = $1`,
        [userId, pseudonym, `anonymized$${userId}`],
      );
      const details = {
        sessionsInvalidated: sessions.rowCount ?? 0,
        lifecycleRecordsPseudonymized: lifecycle.rowCount ?? 0,
        preservedRecords: ['orders', 'payments', 'refunds', 'financial snapshots', 'audit history'],
      };
      await this.recordAction(
        client,
        userId,
        'ACCOUNT_ANONYMIZED',
        'COMPLETED',
        reasonCode,
        details,
      );
      return { userId, action: 'ACCOUNT_ANONYMIZED', status: 'COMPLETED', details };
    });
  }

  async setRetentionHold(userId: string, reasonCode: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO app.privacy_subject_controls (user_id, retention_hold, retention_hold_reason, updated_at)
       VALUES ($1, true, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET retention_hold = true, retention_hold_reason = EXCLUDED.retention_hold_reason,
         updated_at = now()`,
      [userId, reasonCode],
    );
  }

  async deleteEligibleUnfinishedProjects(
    userId: string,
    storage: PrivateObjectStorage,
    now = new Date(),
  ): Promise<PrivacyActionResult> {
    const report = await this.inspectUser(userId, now);
    if (report.retentionHold) {
      return {
        userId,
        action: 'UNFINISHED_PROJECT_DELETED',
        status: 'BLOCKED',
        details: { reason: 'retention-hold' },
      };
    }
    const deletedProjectIds: string[] = [];
    for (const projectId of report.eligibleUnfinishedProjectIds) {
      const deleted = await withTransaction(this.pool, async (client) => {
        const project = await this.eligibleProjects(client, userId, now, projectId);
        if (!project[0]) return false;
        const assets = await this.assetsForProjects([projectId], client);
        for (const asset of assets) await storage.delete(asset.storage_key);
        await client.query(`DELETE FROM app.projects WHERE id = $1`, [projectId]);
        return true;
      });
      if (deleted) deletedProjectIds.push(projectId);
    }
    const details = {
      deletedProjectIds,
      canonicalSideEffects: { orders: 0, payments: 0, refunds: 0 },
    };
    await this.pool.query(
      `INSERT INTO app.privacy_data_actions (user_id, action, status, reason_code, details)
       VALUES ($1, 'UNFINISHED_PROJECT_DELETED', 'COMPLETED', 'RETENTION_EXPIRY', $2::jsonb)`,
      [userId, JSON.stringify(details)],
    );
    return { userId, action: 'UNFINISHED_PROJECT_DELETED', status: 'COMPLETED', details };
  }

  private async lockUser(client: SqlClient, userId: string): Promise<UserRow> {
    const result = await client.query<UserRow & { retention_hold: boolean }>(
      `SELECT u.id, u.email, coalesce(c.retention_hold, false) AS retention_hold FROM app.users u
       LEFT JOIN app.privacy_subject_controls c ON c.user_id = u.id WHERE u.id = $1 FOR UPDATE OF u`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('User not found.');
    return row;
  }

  private async recordAction(
    client: SqlClient,
    userId: string,
    action: PrivacyActionResult['action'],
    status: PrivacyActionResult['status'],
    reasonCode: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO app.privacy_data_actions (user_id, action, status, reason_code, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [userId, action, status, reasonCode, JSON.stringify(details)],
    );
  }

  private async eligibleProjects(
    client: SqlClient,
    userId: string,
    now: Date,
    onlyProjectId?: string,
  ): Promise<EligibleProjectRow[]> {
    const result = await client.query<EligibleProjectRow>(
      `SELECT p.id FROM app.projects p
       WHERE p.owner_type = 'USER' AND p.owner_user_id = $1 AND p.expires_at <= $2
         AND NOT EXISTS (SELECT 1 FROM app.order_items i WHERE i.project_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM app.cart_items ci WHERE ci.project_id = p.id)
         AND ($3::uuid IS NULL OR p.id = $3::uuid)
       FOR UPDATE`,
      [userId, now, onlyProjectId ?? null],
    );
    return result.rows;
  }

  private async assetsForProjects(
    projectIds: string[],
    client: SqlClient = this.pool,
  ): Promise<AssetRow[]> {
    if (!projectIds.length) return [];
    const result = await client.query<AssetRow>(
      `SELECT id, storage_key FROM app.assets WHERE project_id = ANY($1::uuid[])`,
      [projectIds],
    );
    return result.rows;
  }
}

export function hashLifecycleIdentifier(value: string): string {
  return hashIdentifier(value);
}

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

async function count(pool: SqlPool, sql: string, values: readonly unknown[]): Promise<number> {
  const result = await pool.query<CountRow>(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}
