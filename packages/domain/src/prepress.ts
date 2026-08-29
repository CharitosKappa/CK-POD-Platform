import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';
import {
  SharpProductionRenderer,
  createControlledPrepressPreview,
  developmentDtgProfile,
  productionRendererVersion,
  type PrepressFinding,
  type PrepressRunStatus,
  type ProductionProfile,
  type RenderAssetResolver,
  type SourceAsset,
  validatePreflight,
} from '@let-it-be/prepress';
import { type BackgroundJobQueue, type QueueWorker } from '@let-it-be/queue';
import type { PrivateObjectStorage } from '@let-it-be/storage';
import { migrateEditorDocument, type EditorDocumentV1 } from '@let-it-be/editor-schema';

import type { ActiveSession } from './identity';

const prepressQueueName = 'prepress-render';
const prepressJobName = 'run-prepress';

export interface PrepressSummary {
  id: string;
  projectId: string;
  projectVersionId: string;
  status: PrepressRunStatus;
  profileId: string;
  rendererVersion: string;
  score: {
    total: number;
    band: 'GREEN' | 'AMBER' | 'RED';
    blockers: number;
    warnings: number;
  } | null;
  findings: Array<Pick<PrepressFinding, 'code' | 'severity' | 'message' | 'layerId'>>;
  previewAssetId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

interface ProjectVersionRow {
  project_id: string;
  project_version_id: string;
  editor_document: unknown;
  product_model_id: string;
  selected_color_code: string;
}

interface ProfileRow {
  id: string;
  product_model_id: string;
  provider_id: string | null;
  decoration_method: 'DTG';
  qualification_status: ProductionProfile['qualificationStatus'];
  profile_data: Omit<
    ProductionProfile,
    | 'id'
    | 'productModelId'
    | 'providerId'
    | 'decorationMethod'
    | 'qualificationStatus'
    | 'developmentOnly'
  >;
  development_only: boolean;
}

interface RunRow {
  id: string;
  project_id: string;
  project_version_id: string;
  production_profile_id: string;
  status: PrepressRunStatus;
  renderer_version: string;
  retry_count: number;
  score: {
    total: number;
    band: 'GREEN' | 'AMBER' | 'RED';
    blockers: number;
    warnings: number;
  } | null;
  preview_asset_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}

interface FindingRow {
  code: string;
  severity: PrepressFinding['severity'];
  message: string;
  affected_layer_id: string | null;
}

interface WorkRow extends RunRow {
  editor_document: unknown;
  selected_color_code: string;
}

interface ResolvedAssetRow {
  requested_asset_id: string;
  id: string;
  storage_key: string;
  content_type: string;
  width: number | null;
  height: number | null;
}

export class PrepressAccessError extends Error {}

export class PrepressService {
  private readonly renderer = new SharpProductionRenderer();

  public constructor(
    private readonly pool: SqlPool,
    private readonly queue: BackgroundJobQueue,
    private readonly storage: PrivateObjectStorage,
  ) {}

  async request(session: ActiveSession, projectId: string): Promise<PrepressSummary> {
    const queued = await withTransaction(this.pool, async (client) => {
      const version = await loadActiveProjectVersion(client, session, projectId, true);
      if (!version) throw new PrepressAccessError('Project not found.');
      const document = migrateEditorDocument(version.editor_document);
      const profile = await loadProfile(client, document.printArea.profileId);
      if (!profile || profile.productModelId !== version.product_model_id) {
        throw new Error('No compatible production profile is available for this T-shirt.');
      }
      const idempotencyKey = `prepress:${version.project_version_id}:${profile.id}:${productionRendererVersion}`;
      const existing = await client.query<RunRow>(
        `SELECT ${runColumns()} FROM app.prepress_runs WHERE idempotency_key = $1 FOR UPDATE`,
        [idempotencyKey],
      );
      const row = existing.rows[0];
      if (row && row.status !== 'FAILED') return { row, enqueue: false };
      if (row) {
        const retried = await client.query<RunRow>(
          `UPDATE app.prepress_runs
           SET status = 'PENDING', retry_count = retry_count + 1, failure_detail = NULL, failed_at = NULL
           WHERE id = $1 RETURNING ${runColumns()}`,
          [row.id],
        );
        return { row: requireRow(retried.rows[0], 'Could not retry prepress.'), enqueue: true };
      }
      const inserted = await client.query<RunRow>(
        `INSERT INTO app.prepress_runs (
          project_id, project_version_id, production_profile_id, status, renderer_version, idempotency_key
        ) VALUES ($1, $2, $3, 'PENDING', $4, $5) RETURNING ${runColumns()}`,
        [
          projectId,
          version.project_version_id,
          profile.id,
          productionRendererVersion,
          idempotencyKey,
        ],
      );
      return { row: requireRow(inserted.rows[0], 'Could not request prepress.'), enqueue: true };
    });
    if (queued.enqueue) await this.enqueue(queued.row);
    return this.summary(session, projectId, queued.row.id);
  }

  async latest(session: ActiveSession, projectId: string): Promise<PrepressSummary | null> {
    const result = await this.pool.query<RunRow>(
      `SELECT ${runColumns('r')}
       FROM app.prepress_runs r JOIN app.projects p ON p.id = r.project_id
       WHERE r.project_id = $1 AND ${ownershipClause(2, 3)}
       ORDER BY r.created_at DESC LIMIT 1`,
      [projectId, session.id, session.userId],
    );
    return result.rows[0] ? this.summary(session, projectId, result.rows[0].id) : null;
  }

  async summary(
    session: ActiveSession,
    projectId: string,
    runId: string,
  ): Promise<PrepressSummary> {
    const result = await this.pool.query<RunRow>(
      `SELECT ${runColumns('r')}
       FROM app.prepress_runs r JOIN app.projects p ON p.id = r.project_id
       WHERE r.id = $1 AND r.project_id = $2 AND ${ownershipClause(3, 4)}`,
      [runId, projectId, session.id, session.userId],
    );
    const row = result.rows[0];
    if (!row) throw new PrepressAccessError('Prepress result not found.');
    const findings = await this.pool.query<FindingRow>(
      `SELECT code, severity, message, affected_layer_id
       FROM app.prepress_findings WHERE prepress_run_id = $1 ORDER BY created_at, id`,
      [row.id],
    );
    return mapSummary(row, findings.rows);
  }

  async process(runId: string): Promise<void> {
    const claimed = await this.pool.query<WorkRow>(
      `UPDATE app.prepress_runs SET status = 'RENDERING', started_at = COALESCE(started_at, now())
       WHERE id = $1 AND status = 'PENDING'
       RETURNING ${runColumns()},
         (SELECT pv.editor_document FROM app.project_versions pv WHERE pv.id = project_version_id) AS editor_document,
         (SELECT p.selected_color_code FROM app.projects p WHERE p.id = project_id) AS selected_color_code`,
      [runId],
    );
    const work = claimed.rows[0];
    if (!work) return;
    try {
      const document = migrateEditorDocument(work.editor_document);
      const profile = await loadProfile(this.pool, work.production_profile_id);
      if (!profile) throw new Error('Production profile is unavailable.');
      const resolver = await this.sourceResolver(work.project_id, document);
      const master = await this.renderer.render({ document, profile, assets: resolver });
      await this.pool.query(`UPDATE app.prepress_runs SET status = 'VALIDATING' WHERE id = $1`, [
        runId,
      ]);
      const preflight = validatePreflight({
        document,
        profile,
        master,
        productColorCode: work.selected_color_code,
        moderationStatus: 'UNKNOWN',
      });
      const masterKey = `prepress/${runId}/production-master.png`;
      const previewKey = `prepress/${runId}/controlled-preview.png`;
      const preview = await createControlledPrepressPreview(master.png);
      await this.storage.put({
        key: masterKey,
        body: master.png,
        contentType: 'image/png',
        metadata: { assetClass: 'production-master', rendererVersion: master.rendererVersion },
      });
      await this.storage.put({
        key: previewKey,
        body: preview,
        contentType: 'image/png',
        metadata: { assetClass: 'controlled-prepress-preview' },
      });
      await withTransaction(this.pool, async (client) => {
        const masterAssetId = await insertAsset(client, {
          projectId: work.project_id,
          type: 'PRODUCTION_MASTER',
          storageKey: masterKey,
          byteSize: master.png.byteLength,
          width: master.width,
          height: master.height,
        });
        const previewAssetId = await insertAsset(client, {
          projectId: work.project_id,
          type: 'PREPRESS_PREVIEW',
          storageKey: previewKey,
          byteSize: preview.byteLength,
          width: Math.min(1200, master.width),
          height: Math.min(1200, master.height),
          sourceAssetId: masterAssetId,
        });
        for (const sourceAssetId of master.sourceAssetIds) {
          await client.query(
            `INSERT INTO app.asset_lineage (derived_asset_id, source_asset_id, relationship)
             VALUES ($1, $2, 'PRODUCTION_RENDER_SOURCE') ON CONFLICT DO NOTHING`,
            [masterAssetId, sourceAssetId],
          );
        }
        await client.query(`DELETE FROM app.prepress_findings WHERE prepress_run_id = $1`, [runId]);
        for (const finding of preflight.findings) {
          await client.query(
            `INSERT INTO app.prepress_findings (prepress_run_id, category, code, severity, affected_layer_id, message, evidence)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
            [
              runId,
              finding.category,
              finding.code,
              finding.severity,
              finding.layerId ?? null,
              finding.message,
              JSON.stringify(finding.evidence),
            ],
          );
        }
        await client.query(
          `UPDATE app.prepress_runs
           SET status = $2, production_master_asset_id = $3, preview_asset_id = $4,
               score = $5::jsonb, source_asset_ids = $6::jsonb, output_metadata = $7::jsonb,
               completed_at = now(), failure_detail = NULL
           WHERE id = $1`,
          [
            runId,
            preflight.readiness,
            masterAssetId,
            previewAssetId,
            JSON.stringify({
              total: preflight.score.total,
              band: preflight.score.band,
              blockers: preflight.score.blockers.length,
              warnings: preflight.score.warnings.length,
              components: preflight.score.components,
            }),
            JSON.stringify(master.sourceAssetIds),
            JSON.stringify({
              width: master.width,
              height: master.height,
              pixelHash: master.pixelHash,
              rendererVersion: master.rendererVersion,
              physicalWidthInches: profile.physicalWidthInches,
              physicalHeightInches: profile.physicalHeightInches,
            }),
          ],
        );
      });
    } catch (error) {
      await this.pool.query(
        `UPDATE app.prepress_runs SET status = 'FAILED', failure_detail = $2, failed_at = now() WHERE id = $1`,
        [runId, safeError(error)],
      );
    }
  }

  private async enqueue(run: RunRow): Promise<void> {
    const job = await this.queue.enqueue<PrepressJobPayload>({
      queue: prepressQueueName,
      name: prepressJobName,
      payload: { prepressRunId: run.id },
      options: { attempts: 3, idempotencyKey: `prepress:${run.id}:${run.retry_count}` },
    });
    await this.pool.query(`UPDATE app.prepress_runs SET queue_job_id = $1 WHERE id = $2`, [
      job.id,
      run.id,
    ]);
  }

  private async sourceResolver(
    projectId: string,
    document: EditorDocumentV1,
  ): Promise<RenderAssetResolver> {
    const requestedIds = document.layers
      .filter((layer) => layer.type !== 'text')
      .map((layer) => layer.assetId);
    const rows = requestedIds.length
      ? await this.pool.query<ResolvedAssetRow>(
          `SELECT requested.id AS requested_asset_id, source.id, source.storage_key, source.content_type, source.width, source.height
           FROM app.assets requested
           JOIN app.assets source ON source.id = COALESCE(requested.source_asset_id, requested.id)
           WHERE requested.project_id = $1 AND requested.id = ANY($2::uuid[]) AND source.status = 'ACTIVE'`,
          [projectId, requestedIds],
        )
      : { rows: [] as ResolvedAssetRow[] };
    const byRequestedId = new Map(rows.rows.map((row) => [row.requested_asset_id, row]));
    return {
      getSourceAsset: async (assetId: string): Promise<SourceAsset | null> => {
        const row = byRequestedId.get(assetId);
        if (!row) return null;
        const object = await this.storage.get(row.storage_key);
        return object
          ? {
              id: row.id,
              body: object.body,
              contentType: row.content_type,
              width: row.width,
              height: row.height,
            }
          : null;
      },
    };
  }
}

export interface PrepressJobPayload {
  prepressRunId: string;
}

export async function startPrepressConsumer(
  queue: BackgroundJobQueue,
  process: (prepressRunId: string) => Promise<void>,
): Promise<QueueWorker> {
  return queue.process<PrepressJobPayload>(prepressQueueName, async (job) => {
    if (job.name === prepressJobName) await process(job.payload.prepressRunId);
  });
}

export function prepressQueueDetails() {
  return { queue: prepressQueueName, name: prepressJobName };
}

async function loadActiveProjectVersion(
  client: SqlClient,
  session: ActiveSession,
  projectId: string,
  forUpdate: boolean,
): Promise<ProjectVersionRow | null> {
  const result = await client.query<ProjectVersionRow>(
    `SELECT p.id AS project_id, pv.id AS project_version_id, pv.editor_document, p.product_model_id, p.selected_color_code
     FROM app.projects p JOIN app.project_versions pv ON pv.id = p.active_version_id
     WHERE p.id = $1 AND ${ownershipClause(2, 3)} ${forUpdate ? 'FOR UPDATE OF p' : ''}`,
    [projectId, session.id, session.userId],
  );
  return result.rows[0] ?? null;
}

async function loadProfile(
  client: SqlClient,
  profileId: string,
): Promise<ProductionProfile | null> {
  if (profileId === developmentDtgProfile.id) return developmentDtgProfile;
  const result = await client.query<ProfileRow>(
    `SELECT id, product_model_id, provider_id, decoration_method, qualification_status, profile_data, development_only
     FROM app.production_profiles WHERE id = $1`,
    [profileId],
  );
  const row = result.rows[0];
  return row
    ? {
        ...row.profile_data,
        id: row.id,
        productModelId: row.product_model_id,
        providerId: row.provider_id,
        decorationMethod: row.decoration_method,
        qualificationStatus: row.qualification_status,
        developmentOnly: row.development_only,
      }
    : null;
}

async function insertAsset(
  client: SqlClient,
  input: {
    projectId: string;
    type: 'PRODUCTION_MASTER' | 'PREPRESS_PREVIEW';
    storageKey: string;
    byteSize: number;
    width: number;
    height: number;
    sourceAssetId?: string;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO app.assets (project_id, asset_type, storage_key, content_type, byte_size, width, height, source_asset_id)
     VALUES ($1, $2, $3, 'image/png', $4, $5, $6, $7) RETURNING id`,
    [
      input.projectId,
      input.type,
      input.storageKey,
      input.byteSize,
      input.width,
      input.height,
      input.sourceAssetId ?? null,
    ],
  );
  return requireRow(result.rows[0], 'Could not store prepress asset.').id;
}

function mapSummary(row: RunRow, findings: FindingRow[]): PrepressSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    projectVersionId: row.project_version_id,
    status: row.status,
    profileId: row.production_profile_id,
    rendererVersion: row.renderer_version,
    score: row.score,
    findings: findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      ...(finding.affected_layer_id ? { layerId: finding.affected_layer_id } : {}),
    })),
    previewAssetId: row.preview_asset_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function runColumns(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}id, ${prefix}project_id, ${prefix}project_version_id, ${prefix}production_profile_id, ${prefix}status, ${prefix}renderer_version, ${prefix}retry_count, ${prefix}score, ${prefix}preview_asset_id, ${prefix}created_at, ${prefix}completed_at`;
}

function ownershipClause(sessionPosition: number, userPosition: number): string {
  return `((p.owner_type = 'GUEST' AND p.owner_session_id = $${sessionPosition}) OR (p.owner_type = 'USER' AND p.owner_user_id = $${userPosition}::uuid))`;
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : 'Prepress processing failed.').slice(0, 300);
}
