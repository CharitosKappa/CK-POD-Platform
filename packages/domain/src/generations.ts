import { randomUUID } from 'node:crypto';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';
import type { BackgroundJobQueue, QueueWorker } from '@let-it-be/queue';

import {
  type GenerationFailureCategory,
  type GenerationRateLimiter,
  type GenerationStatus,
  GenerationAccessError,
  type ProductGenerationContext,
  type PromptPipeline,
} from './ai-contracts';
import type { CreditService } from './credits';
import type { ActiveSession } from './identity';

const generationQueueName = 'ai-generation';
const generationJobName = 'run-generation';

export interface GenerationCreateInput {
  rawPrompt: string;
  style?: string;
  referenceAssetIds?: string[];
}

export interface GenerationSummary {
  id: string;
  projectId: string;
  status: GenerationStatus;
  creditStatus: 'PENDING' | 'CONSUMED' | 'NOT_CONSUMED' | 'REFUNDED';
  failureCategory: GenerationFailureCategory | null;
  requestedExactText: string[];
  previewAsset: {
    id: string;
    contentType: string;
    width: number | null;
    height: number | null;
  } | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface GenerationJobPayload {
  generationId: string;
}

interface ProjectContextRow {
  id: string;
  product_model_id: string;
  selected_color_code: string;
  display_name: string;
  color_name: string;
}

interface GenerationRow {
  id: string;
  project_id: string;
  status: GenerationStatus;
  credit_status: GenerationSummary['creditStatus'];
  failure_category: GenerationFailureCategory | null;
  prompt_metadata: { requestedExactText?: unknown };
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  preview_asset_id: string | null;
  preview_content_type: string | null;
  preview_width: number | null;
  preview_height: number | null;
}

export interface GenerationServiceOptions {
  maxReferenceAssets?: number;
}

export class GenerationService {
  private readonly maxReferenceAssets: number;

  public constructor(
    private readonly pool: SqlPool,
    private readonly queue: BackgroundJobQueue,
    private readonly credits: CreditService,
    private readonly promptPipeline: PromptPipeline,
    private readonly rateLimiter: GenerationRateLimiter,
    options: GenerationServiceOptions = {},
  ) {
    this.maxReferenceAssets = options.maxReferenceAssets ?? 5;
  }

  async create(
    session: ActiveSession,
    projectId: string,
    input: GenerationCreateInput,
  ): Promise<GenerationSummary> {
    if (input.referenceAssetIds && input.referenceAssetIds.length > this.maxReferenceAssets) {
      throw new Error(`No more than ${this.maxReferenceAssets} reference assets are allowed.`);
    }
    if (!(await this.rateLimiter.allow({ subjectId: session.userId ?? session.id, projectId }))) {
      throw new Error('Please wait before requesting another generation.');
    }

    const generation = await withTransaction(this.pool, async (client) => {
      const context = await loadProjectContext(client, session, projectId);
      if (!context) throw new GenerationAccessError('Project not found.');
      const referenceAssetIds = input.referenceAssetIds ?? [];
      await assertReferenceAssets(client, projectId, referenceAssetIds);
      const creditAccount = await this.credits.assertGenerationCapacity(client, session);
      const prepared = this.promptPipeline.prepare({
        rawPrompt: input.rawPrompt,
        style: input.style?.trim() || null,
        productContext: context,
        referenceAssetIds,
      });
      const result = await client.query<GenerationRow>(
        `INSERT INTO app.generations (
          project_id, requested_by_session_id, requested_by_user_id, status,
          raw_prompt, enhanced_prompt, prompt_metadata, style_metadata, product_context,
          reference_asset_ids, credit_account_id
        ) VALUES ($1, $2, $3, 'QUEUED', $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)
        RETURNING ${generationReturning()}`,
        [
          projectId,
          session.id,
          session.userId,
          input.rawPrompt.trim(),
          prepared.enhancedPrompt,
          JSON.stringify(prepared.metadata),
          JSON.stringify({ style: input.style?.trim() || null }),
          JSON.stringify(context),
          JSON.stringify(referenceAssetIds),
          creditAccount.id,
        ],
      );
      return mapGeneration(requireRow(result.rows[0], 'Could not create generation.'));
    });

    try {
      const job = await this.queue.enqueue<GenerationJobPayload>({
        queue: generationQueueName,
        name: generationJobName,
        payload: { generationId: generation.id },
        options: { attempts: 1, idempotencyKey: `generation:${generation.id}` },
      });
      await this.pool.query(
        "UPDATE app.generations SET queue_job_id = $1 WHERE id = $2 AND status = 'QUEUED'",
        [job.id, generation.id],
      );
    } catch {
      await markUndeliverableGeneration(this.pool, generation.id, 'CONFIGURATION_ERROR');
      throw new Error('Generation could not be queued. Please try again.');
    }
    return generation;
  }

  async get(
    session: ActiveSession,
    projectId: string,
    generationId: string,
  ): Promise<GenerationSummary | null> {
    const result = await this.pool.query<GenerationRow>(
      `SELECT ${generationSelection()}
       FROM app.generations g
       JOIN app.projects p ON p.id = g.project_id
       LEFT JOIN app.assets preview ON preview.id = g.delivered_asset_id
       WHERE g.id = $1 AND g.project_id = $2 AND ${projectOwnershipClause(3, 4)}`,
      [generationId, projectId, session.id, session.userId],
    );
    return result.rows[0] ? mapGeneration(result.rows[0]) : null;
  }

  async getForWorker(generationId: string): Promise<GenerationWorkItem | null> {
    const result = await this.pool.query<GenerationWorkRow>(
      `SELECT g.id, g.project_id, g.status, g.raw_prompt, g.enhanced_prompt, g.prompt_metadata,
              g.product_context, g.reference_asset_ids, g.credit_account_id
       FROM app.generations g WHERE g.id = $1`,
      [generationId],
    );
    return result.rows[0] ? mapWorkItem(result.rows[0]) : null;
  }

  async claim(generationId: string): Promise<GenerationWorkItem | null> {
    const result = await this.pool.query<GenerationWorkRow>(
      `UPDATE app.generations SET status = 'PROCESSING', started_at = COALESCE(started_at, now())
       WHERE id = $1 AND status = 'QUEUED'
       RETURNING id, project_id, status, raw_prompt, enhanced_prompt, prompt_metadata,
                 product_context, reference_asset_ids, credit_account_id`,
      [generationId],
    );
    return result.rows[0] ? mapWorkItem(result.rows[0]) : null;
  }

  async reject(
    generationId: string,
    category: Extract<
      GenerationFailureCategory,
      'MODERATION_REJECTION' | 'INTERNAL_VALIDATION_FAILURE'
    >,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE app.generations SET status = 'REJECTED_INTERNAL', credit_status = 'NOT_CONSUMED',
         failure_category = $2, failed_at = now()
       WHERE id = $1 AND status NOT IN ('SUCCEEDED', 'CANCELLED')`,
      [generationId, category],
    );
  }

  async fail(generationId: string, category: GenerationFailureCategory): Promise<void> {
    await markUndeliverableGeneration(this.pool, generationId, category);
  }
}

export interface GenerationWorkItem {
  id: string;
  projectId: string;
  rawPrompt: string;
  enhancedPrompt: string;
  requestedExactText: string[];
  productContext: ProductGenerationContext;
  referenceAssetIds: string[];
  creditAccountId: string;
}

interface GenerationWorkRow {
  id: string;
  project_id: string;
  status: GenerationStatus;
  raw_prompt: string;
  enhanced_prompt: string;
  prompt_metadata: { requestedExactText?: unknown };
  product_context: unknown;
  reference_asset_ids: unknown;
  credit_account_id: string | null;
}

export async function startGenerationConsumer(
  queue: BackgroundJobQueue,
  process: (generationId: string) => Promise<void>,
): Promise<QueueWorker> {
  return queue.process<GenerationJobPayload>(generationQueueName, async (job) => {
    if (job.name !== generationJobName) return;
    await process(job.payload.generationId);
  });
}

export function newPrivateAssetKey(input: {
  generationId: string;
  kind: 'source' | 'preview';
  contentType: string;
}): string {
  return `generations/${input.generationId}/${input.kind}-${randomUUID()}.${extensionFor(input.contentType)}`;
}

export function generationQueueDetails() {
  return { queue: generationQueueName, name: generationJobName };
}

async function loadProjectContext(
  client: SqlClient,
  session: ActiveSession,
  projectId: string,
): Promise<ProductGenerationContext | null> {
  const result = await client.query<ProjectContextRow>(
    `SELECT p.id, p.product_model_id, p.selected_color_code, model.display_name, variant.color_name
     FROM app.projects p
     JOIN app.product_models model ON model.id = p.product_model_id
     JOIN app.product_variants variant
       ON variant.product_model_id = p.product_model_id AND variant.color_code = p.selected_color_code
     WHERE p.id = $1 AND ${projectOwnershipClause(2, 3)}
     LIMIT 1`,
    [projectId, session.id, session.userId],
  );
  const row = result.rows[0];
  return row
    ? {
        productModelId: row.product_model_id,
        productDisplayName: row.display_name,
        colorCode: row.selected_color_code,
        colorName: row.color_name,
        printArea: {},
      }
    : null;
}

async function assertReferenceAssets(
  client: SqlClient,
  projectId: string,
  assetIds: string[],
): Promise<void> {
  if (!assetIds.length) return;
  if (new Set(assetIds).size !== assetIds.length)
    throw new Error('Reference assets must be unique.');
  const result = await client.query<{ id: string }>(
    `SELECT id FROM app.assets
     WHERE project_id = $1 AND id = ANY($2::uuid[]) AND asset_type = 'REFERENCE' AND status = 'ACTIVE'`,
    [projectId, assetIds],
  );
  if (result.rows.length !== assetIds.length)
    throw new Error('One or more reference assets are unavailable.');
}

async function markUndeliverableGeneration(
  pool: SqlPool,
  generationId: string,
  category: GenerationFailureCategory,
): Promise<void> {
  await pool.query(
    `UPDATE app.generations SET status = 'FAILED', credit_status = 'NOT_CONSUMED',
       failure_category = $2, failed_at = now()
     WHERE id = $1 AND status NOT IN ('SUCCEEDED', 'CANCELLED')`,
    [generationId, category],
  );
}

function generationSelection(): string {
  return `g.id, g.project_id, g.status, g.credit_status, g.failure_category, g.prompt_metadata,
    g.created_at, g.started_at, g.completed_at, preview.id AS preview_asset_id,
    preview.content_type AS preview_content_type, preview.width AS preview_width, preview.height AS preview_height`;
}

function generationReturning(): string {
  return `id, project_id, status, credit_status, failure_category, prompt_metadata,
    created_at, started_at, completed_at, NULL::uuid AS preview_asset_id,
    NULL::text AS preview_content_type, NULL::integer AS preview_width, NULL::integer AS preview_height`;
}

function projectOwnershipClause(sessionPosition: number, userPosition: number): string {
  return `((p.owner_type = 'GUEST' AND p.owner_session_id = $${sessionPosition})
    OR (p.owner_type = 'USER' AND p.owner_user_id = $${userPosition}::uuid))`;
}

function mapGeneration(row: GenerationRow): GenerationSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    creditStatus: row.credit_status,
    failureCategory: row.failure_category,
    requestedExactText: stringArray(row.prompt_metadata.requestedExactText),
    previewAsset: row.preview_asset_id
      ? {
          id: row.preview_asset_id,
          contentType: row.preview_content_type ?? 'application/octet-stream',
          width: row.preview_width,
          height: row.preview_height,
        }
      : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function mapWorkItem(row: GenerationWorkRow): GenerationWorkItem {
  if (!row.credit_account_id) throw new Error('Generation has no credit account.');
  return {
    id: row.id,
    projectId: row.project_id,
    rawPrompt: row.raw_prompt,
    enhancedPrompt: row.enhanced_prompt,
    requestedExactText: stringArray(row.prompt_metadata.requestedExactText),
    productContext: row.product_context as ProductGenerationContext,
    referenceAssetIds: stringArray(row.reference_asset_ids),
    creditAccountId: row.credit_account_id,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
}

function extensionFor(contentType: string): string {
  if (contentType === 'image/svg+xml') return 'svg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  return 'bin';
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}
