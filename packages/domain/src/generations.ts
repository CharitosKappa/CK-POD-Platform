import { randomUUID } from 'node:crypto';

import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';
import type { BackgroundJobQueue, QueueWorker } from '@let-it-be/queue';

import {
  type GenerationFailureCategory,
  type GenerationRateLimiter,
  type GenerationStatus,
  type AiTask,
  GenerationAccessError,
  GenerationPolicyBlockedError,
  type ProductGenerationContext,
  type PromptPipeline,
} from './ai-contracts';
import type { CreditService } from './credits';
import type { ActiveSession } from './identity';
import {
  resolvePersistedStyleSelection,
  type ResolvedStyleSelection,
  type StyleSelection,
} from './styles';
import { recordGenerationAnalyticsEvent } from './analytics';
import type { PolicyService } from './policy';

const generationQueueName = 'ai-generation';
const generationJobName = 'run-generation';

export interface GenerationCreateInput {
  rawPrompt: string;
  /** @deprecated Milestone 4.5 resolves a server-owned structured preset instead. */
  style?: string;
  referenceAssetIds?: string[];
  task?: Extract<AiTask, 'TEXT_TO_ARTWORK' | 'SELECTED_ELEMENT_EDITING'>;
  editorMetadata?: { targetLayerId: string; lockedLayerIds: string[] };
}

export interface GenerationSummary {
  id: string;
  projectId: string;
  status: GenerationStatus;
  creditStatus: 'PENDING' | 'CONSUMED' | 'NOT_CONSUMED' | 'REFUNDED';
  failureCategory: GenerationFailureCategory | null;
  requestedExactText: string[];
  styleSelection: StyleSelection;
  task: Extract<AiTask, 'TEXT_TO_ARTWORK' | 'SELECTED_ELEMENT_EDITING'>;
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
  active_version_id: string | null;
  product_model_id: string;
  selected_color_code: string;
  style_selection_mode: StyleSelection['selectionMode'];
  style_family_id: string | null;
  style_preset_id: string | null;
  style_preset_version: number | null;
  display_name: string;
  color_name: string;
}

interface ProjectGenerationContext extends ProductGenerationContext {
  active_version_id: string | null;
  style_selection_mode: StyleSelection['selectionMode'];
  style_family_id: string | null;
  style_preset_id: string | null;
  style_preset_version: number | null;
}

interface GenerationRow {
  id: string;
  project_id: string;
  status: GenerationStatus;
  credit_status: GenerationSummary['creditStatus'];
  failure_category: GenerationFailureCategory | null;
  prompt_metadata: { requestedExactText?: unknown };
  task: GenerationSummary['task'];
  style_selection_mode: StyleSelection['selectionMode'];
  style_family_id: string | null;
  style_preset_id: string | null;
  style_preset_version: number | null;
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
    private readonly policy?: PolicyService,
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
      const styleSelection = await resolvePersistedStyleSelection(
        client,
        projectStyleSelection(context),
        { projectId, rawPrompt: input.rawPrompt },
      );
      if (
        context.style_family_id !== styleSelection.styleFamilyId ||
        context.style_preset_id !== styleSelection.presetId ||
        context.style_preset_version !== styleSelection.presetVersion
      ) {
        await client.query(
          `UPDATE app.projects
           SET style_selection_mode = $2, style_family_id = $3, style_preset_id = $4,
               style_preset_version = $5, updated_at = now()
           WHERE id = $1`,
          [
            projectId,
            styleSelection.selectionMode,
            styleSelection.styleFamilyId,
            styleSelection.presetId,
            styleSelection.presetVersion,
          ],
        );
      }
      const prepared = this.promptPipeline.prepare({
        rawPrompt: input.rawPrompt,
        styleSelection,
        productContext: context,
        referenceAssetIds,
      });
      if (this.policy) {
        const evaluation = await this.policy.evaluate({
          stage: 'PROMPT_PRE_GENERATION',
          projectId,
          ...(context.active_version_id ? { projectVersionId: context.active_version_id } : {}),
          text: [input.rawPrompt, ...prepared.metadata.requestedExactText].join('\n'),
          metadata: { task: input.task ?? 'TEXT_TO_ARTWORK', referenceAssetIds },
        });
        if (evaluation.outcome === 'BLOCK')
          throw new GenerationPolicyBlockedError(
            'This request cannot be used to create merchandise. Please try a different idea.',
          );
      }
      const result = await client.query<GenerationRow>(
        `INSERT INTO app.generations (
          project_id, requested_by_session_id, requested_by_user_id, status,
          raw_prompt, enhanced_prompt, prompt_metadata, style_metadata, product_context,
          reference_asset_ids, credit_account_id, task, editor_metadata, style_selection_mode,
          style_family_id, style_preset_id, style_preset_version
        ) VALUES ($1, $2, $3, 'QUEUED', $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12::jsonb, $13, $14, $15, $16)
        RETURNING ${generationReturning()}`,
        [
          projectId,
          session.id,
          session.userId,
          input.rawPrompt.trim(),
          prepared.enhancedPrompt,
          JSON.stringify(prepared.metadata),
          JSON.stringify({
            styleFamily: styleSelection.styleFamily.displayName,
            preset: styleSelection.preset.displayName,
            selectionMode: styleSelection.selectionMode,
          }),
          JSON.stringify(context),
          JSON.stringify(referenceAssetIds),
          creditAccount.id,
          input.task ?? 'TEXT_TO_ARTWORK',
          JSON.stringify(input.editorMetadata ?? {}),
          styleSelection.selectionMode,
          styleSelection.styleFamilyId,
          styleSelection.presetId,
          styleSelection.presetVersion,
        ],
      );
      const created = mapGeneration(requireRow(result.rows[0], 'Could not create generation.'));
      await recordGenerationAnalyticsEvent(client, {
        name: 'generation_started',
        projectId,
        generationId: created.id,
        productContext: context,
        styleSelection,
      });
      return created;
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
      `${generationWorkSelection()} WHERE g.id = $1`,
      [generationId],
    );
    return result.rows[0] ? mapWorkItem(result.rows[0]) : null;
  }

  async claim(generationId: string): Promise<GenerationWorkItem | null> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE app.generations SET status = 'PROCESSING', started_at = COALESCE(started_at, now())
       WHERE id = $1 AND status = 'QUEUED'
       RETURNING id`,
      [generationId],
    );
    return result.rows[0] ? this.getForWorker(generationId) : null;
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
  task: GenerationSummary['task'];
  styleSelection: ResolvedStyleSelection;
}

interface GenerationWorkRow {
  id: string;
  project_id: string;
  status: GenerationStatus;
  raw_prompt: string;
  enhanced_prompt: string;
  prompt_metadata: { requestedExactText?: unknown };
  task: GenerationSummary['task'];
  style_selection_mode: StyleSelection['selectionMode'];
  style_family_id: string | null;
  style_preset_id: string | null;
  style_preset_version: number | null;
  style_configuration: unknown;
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
): Promise<ProjectGenerationContext | null> {
  const result = await client.query<ProjectContextRow>(
    `SELECT p.id, p.active_version_id, p.product_model_id, p.selected_color_code, p.style_selection_mode,
            p.style_family_id, p.style_preset_id, p.style_preset_version,
            model.display_name, variant.color_name
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
        active_version_id: row.active_version_id,
        style_selection_mode: row.style_selection_mode,
        style_family_id: row.style_family_id,
        style_preset_id: row.style_preset_id,
        style_preset_version: row.style_preset_version,
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
  return `g.id, g.project_id, g.status, g.credit_status, g.failure_category, g.prompt_metadata, g.task,
    g.style_selection_mode, g.style_family_id, g.style_preset_id, g.style_preset_version,
    g.created_at, g.started_at, g.completed_at, preview.id AS preview_asset_id,
    preview.content_type AS preview_content_type, preview.width AS preview_width, preview.height AS preview_height`;
}

function generationReturning(): string {
  return `id, project_id, status, credit_status, failure_category, prompt_metadata, task,
    style_selection_mode, style_family_id, style_preset_id, style_preset_version,
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
    styleSelection: {
      selectionMode: row.style_selection_mode,
      styleFamilyId: row.style_family_id,
      presetId: row.style_preset_id,
      presetVersion: row.style_preset_version,
    },
    task: row.task,
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
    task: row.task,
    styleSelection:
      row.style_family_id &&
      row.style_preset_id &&
      row.style_preset_version &&
      row.style_configuration
        ? {
            selectionMode: row.style_selection_mode,
            styleFamilyId: row.style_family_id,
            presetId: row.style_preset_id,
            presetVersion: row.style_preset_version,
            styleFamily: { id: row.style_family_id, displayName: row.style_family_id },
            preset: {
              id: row.style_preset_id,
              displayName: row.style_preset_id,
              version: row.style_preset_version,
            },
            conditioning: row.style_configuration as ResolvedStyleSelection['conditioning'],
          }
        : legacyStyleSelection(),
  };
}

function projectStyleSelection(context: ProjectGenerationContext): StyleSelection {
  return {
    selectionMode: context.style_selection_mode,
    styleFamilyId: context.style_family_id,
    presetId: context.style_preset_id,
    presetVersion: context.style_preset_version,
  };
}

function generationWorkSelection(): string {
  return `SELECT g.id, g.project_id, g.status, g.raw_prompt, g.enhanced_prompt, g.prompt_metadata, g.task,
      g.style_selection_mode, g.style_family_id, g.style_preset_id, g.style_preset_version,
      v.configuration AS style_configuration, g.product_context, g.reference_asset_ids, g.credit_account_id
    FROM app.generations g
    LEFT JOIN app.style_preset_versions v ON v.style_family_id = g.style_family_id
      AND v.preset_id = g.style_preset_id AND v.version = g.style_preset_version`;
}

function legacyStyleSelection(): ResolvedStyleSelection {
  return {
    selectionMode: 'AUTO',
    styleFamilyId: 'legacy-unspecified-family',
    presetId: 'legacy-unspecified-preset',
    presetVersion: 1,
    styleFamily: { id: 'legacy-unspecified-family', displayName: 'Unspecified' },
    preset: { id: 'legacy-unspecified-preset', displayName: 'Unspecified', version: 1 },
    conditioning: {
      promptConditioning: {
        family: 'Unspecified',
        substyle: 'Unspecified',
        direction: 'Use the preserved enhanced prompt.',
      },
      compositionGuidance: { focus: 'single wearable focal point', layout: 'balanced front print' },
      typographyGuidance: { mood: 'unspecified', exactTextIsDeterministic: true },
      colorStrategy: { considerShirtColor: true, avoidLowContrast: true },
      textureDetailGuidance: { detailLevel: 'print-friendly', style: 'unspecified' },
      printGuidance: { transparentBackgroundPreferred: true, avoidTinyDetails: true },
      negativeGuidance: ['unintended readable text'],
      routingHints: { task: 'TEXT_TO_ARTWORK' },
    },
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
