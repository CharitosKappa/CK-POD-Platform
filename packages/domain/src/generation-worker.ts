import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';
import type { AppLogger } from '@let-it-be/observability';
import type { PrivateObjectStorage } from '@let-it-be/storage';

import {
  type GenerationFailureCategory,
  type GenerationModerationService,
  type GenerationProvider,
  type GenerationValidationService,
  ProviderExecutionError,
} from './ai-contracts';
import type { ProviderRegistry } from './ai-providers';
import type { CreditService } from './credits';
import { newPrivateAssetKey, type GenerationService, type GenerationWorkItem } from './generations';

interface AttemptRow {
  id: string;
}

interface AssetRow {
  id: string;
}

export class GenerationWorkerService {
  public constructor(
    private readonly pool: SqlPool,
    private readonly generations: GenerationService,
    private readonly credits: CreditService,
    private readonly providers: ProviderRegistry,
    private readonly storage: PrivateObjectStorage,
    private readonly moderation: GenerationModerationService,
    private readonly validation: GenerationValidationService,
    private readonly logger: AppLogger,
  ) {}

  async process(generationId: string): Promise<void> {
    const generation = await this.generations.claim(generationId);
    if (!generation) return;

    try {
      const promptResult = await this.moderation.checkPrompt({ rawPrompt: generation.rawPrompt });
      const referencesResult = await this.moderation.checkReferenceAssets({
        assetIds: generation.referenceAssetIds,
      });
      if (!promptResult.accepted || !referencesResult.accepted) {
        await this.generations.reject(generation.id, 'MODERATION_REJECTION');
        this.logger.info('generation.rejected_internal', {
          generationId: generation.id,
          stage: 'input',
        });
        return;
      }

      const candidates = this.providers.forTask('TEXT_TO_ARTWORK');
      if (!candidates.length) {
        await this.generations.fail(generation.id, 'CONFIGURATION_ERROR');
        return;
      }

      let lastFailure: GenerationFailureCategory = 'PROVIDER_ERROR';
      for (const [providerIndex, provider] of candidates.entries()) {
        const outcome = await this.tryProvider(generation, provider);
        if (outcome.resolved) return;
        lastFailure = outcome.failureCategory;
        if (!provider.configuration.fallbackEligible || providerIndex === candidates.length - 1)
          break;
      }
      await this.generations.fail(generation.id, lastFailure);
    } catch (error) {
      const category = failureCategory(error);
      await this.generations.fail(generation.id, category);
      this.logger.error('generation.worker_failed', {
        generationId: generation.id,
        failureCategory: category,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async tryProvider(
    generation: GenerationWorkItem,
    provider: GenerationProvider,
  ): Promise<{ resolved: boolean; failureCategory: GenerationFailureCategory }> {
    const maximumAttempts = provider.configuration.maxRetries + 1;
    let lastCategory: GenerationFailureCategory = 'PROVIDER_ERROR';

    for (let retry = 0; retry < maximumAttempts; retry += 1) {
      const attempt = await this.startAttempt(generation.id, provider);
      const startedAt = Date.now();
      try {
        const output = await withTimeout(
          provider.service.generate({
            generationId: generation.id,
            task: 'TEXT_TO_ARTWORK',
            enhancedPrompt: generation.enhancedPrompt,
            requestedExactText: generation.requestedExactText,
            style: null,
            productContext: generation.productContext,
            referenceAssetIds: generation.referenceAssetIds,
          }),
          provider.configuration.timeoutMs,
        );
        if (!output.body.byteLength || !output.contentType.startsWith('image/')) {
          throw new ProviderExecutionError(
            'INVALID_PROVIDER_RESPONSE',
            false,
            'Provider did not return a valid image output.',
          );
        }
        await this.finishAttempt(attempt.id, {
          status: 'SUCCEEDED',
          latencyMs: Date.now() - startedAt,
          actualCostCents: output.actualCostCents ?? provider.configuration.estimatedCostCents,
          width: output.width,
          height: output.height,
          ...(output.providerRequestId ? { providerRequestId: output.providerRequestId } : {}),
        });

        await this.markValidating(generation.id);
        const sourceKey = newPrivateAssetKey({
          generationId: generation.id,
          kind: 'source',
          contentType: output.contentType,
        });
        await this.storage.put({
          key: sourceKey,
          body: output.body,
          contentType: output.contentType,
          metadata: { classification: 'generated-source', generationId: generation.id },
        });
        const validation = await this.validation.validate({
          body: output.body,
          contentType: output.contentType,
          width: output.width,
          height: output.height,
          productContext: generation.productContext,
        });
        const outputModeration = await this.moderation.checkOutput({
          body: output.body,
          contentType: output.contentType,
        });
        if (!validation.accepted || !outputModeration.accepted) {
          await this.storage.delete(sourceKey);
          await this.generations.reject(
            generation.id,
            validation.accepted ? 'MODERATION_REJECTION' : 'INTERNAL_VALIDATION_FAILURE',
          );
          this.logger.info('generation.rejected_internal', {
            generationId: generation.id,
            stage: validation.accepted ? 'output-moderation' : 'validation',
          });
          return { resolved: true, failureCategory: 'INTERNAL_VALIDATION_FAILURE' };
        }

        const previewKey = newPrivateAssetKey({
          generationId: generation.id,
          kind: 'preview',
          contentType: output.contentType,
        });
        await this.storage.put({
          key: previewKey,
          body: output.body,
          contentType: output.contentType,
          metadata: { classification: 'generated-preview', generationId: generation.id },
        });
        try {
          await this.deliver(generation, {
            sourceKey,
            previewKey,
            contentType: output.contentType,
            byteSize: output.body.byteLength,
            width: output.width,
            height: output.height,
          });
        } catch (error) {
          await Promise.all([this.storage.delete(sourceKey), this.storage.delete(previewKey)]);
          throw error;
        }
        this.logger.info('generation.succeeded', {
          generationId: generation.id,
          provider: provider.configuration.id,
          model: provider.configuration.model,
          attempt: retry + 1,
          latencyMs: Date.now() - startedAt,
        });
        return { resolved: true, failureCategory: 'UNKNOWN' };
      } catch (error) {
        lastCategory = failureCategory(error);
        await this.finishAttempt(attempt.id, {
          status: 'FAILED',
          latencyMs: Date.now() - startedAt,
          failureCategory: lastCategory,
          failureDetail: safeFailureDetail(error),
        });
        this.logger.warn('generation.provider_attempt_failed', {
          generationId: generation.id,
          provider: provider.configuration.id,
          model: provider.configuration.model,
          failureCategory: lastCategory,
          retry: retry + 1,
        });
        if (!isRetryable(error) || retry === maximumAttempts - 1) break;
      }
    }
    return { resolved: false, failureCategory: lastCategory };
  }

  private async startAttempt(
    generationId: string,
    provider: GenerationProvider,
  ): Promise<{ id: string }> {
    const result = await this.pool.query<AttemptRow>(
      `INSERT INTO app.generation_attempts (
        generation_id, provider_id, model_identifier, task, attempt_number, status, estimated_cost_cents
      ) VALUES (
        $1, $2, $3, 'TEXT_TO_ARTWORK',
        (SELECT COALESCE(max(attempt_number), 0) + 1 FROM app.generation_attempts WHERE generation_id = $1),
        'PROCESSING', $4
      ) RETURNING id`,
      [
        generationId,
        provider.configuration.id,
        provider.configuration.model,
        provider.configuration.estimatedCostCents,
      ],
    );
    return requireRow(result.rows[0], 'Could not record provider attempt.');
  }

  private async finishAttempt(
    attemptId: string,
    result: {
      status: 'SUCCEEDED' | 'FAILED';
      latencyMs: number;
      actualCostCents?: number;
      providerRequestId?: string;
      width?: number;
      height?: number;
      failureCategory?: GenerationFailureCategory;
      failureDetail?: string;
    },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE app.generation_attempts
       SET status = $2, latency_ms = $3, actual_cost_cents = $4, provider_request_id = $5,
           output_width = $6, output_height = $7, failure_category = $8, failure_detail = $9,
           completed_at = now()
       WHERE id = $1`,
      [
        attemptId,
        result.status,
        result.latencyMs,
        result.actualCostCents ?? null,
        result.providerRequestId ?? null,
        result.width ?? null,
        result.height ?? null,
        result.failureCategory ?? null,
        result.failureDetail ?? null,
      ],
    );
  }

  private async markValidating(generationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE app.generations SET status = 'VALIDATING'
       WHERE id = $1 AND status = 'PROCESSING'`,
      [generationId],
    );
  }

  private async deliver(
    generation: GenerationWorkItem,
    input: {
      sourceKey: string;
      previewKey: string;
      contentType: string;
      byteSize: number;
      width: number;
      height: number;
    },
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const source = await insertAsset(client, generation, {
        type: 'SOURCE_OUTPUT',
        storageKey: input.sourceKey,
        contentType: input.contentType,
        byteSize: input.byteSize,
        width: input.width,
        height: input.height,
      });
      const preview = await insertAsset(client, generation, {
        type: 'PREVIEW',
        storageKey: input.previewKey,
        contentType: input.contentType,
        byteSize: input.byteSize,
        width: input.width,
        height: input.height,
        sourceAssetId: source.id,
      });
      await this.credits.consumeDelivered(client, {
        accountId: generation.creditAccountId,
        generationId: generation.id,
      });
      const updated = await client.query<{ id: string }>(
        `UPDATE app.generations
         SET status = 'SUCCEEDED', credit_status = 'CONSUMED', source_asset_id = $2,
             delivered_asset_id = $3, completed_at = now(), failure_category = NULL
         WHERE id = $1 AND status = 'VALIDATING' AND credit_status = 'PENDING'
         RETURNING id`,
        [generation.id, source.id, preview.id],
      );
      requireRow(updated.rows[0], 'Generation was already finalized.');
    });
  }
}

async function insertAsset(
  client: SqlClient,
  generation: GenerationWorkItem,
  input: {
    type: 'SOURCE_OUTPUT' | 'PREVIEW';
    storageKey: string;
    contentType: string;
    byteSize: number;
    width: number;
    height: number;
    sourceAssetId?: string;
  },
): Promise<{ id: string }> {
  const result = await client.query<AssetRow>(
    `INSERT INTO app.assets (
       project_id, generation_id, asset_type, storage_key, content_type, byte_size, width, height, source_asset_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      generation.projectId,
      generation.id,
      input.type,
      input.storageKey,
      input.contentType,
      input.byteSize,
      input.width,
      input.height,
      input.sourceAssetId ?? null,
    ],
  );
  return requireRow(result.rows[0], 'Could not record generated asset.');
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new ProviderExecutionError('PROVIDER_TIMEOUT', true, 'Provider request timed out.')),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function failureCategory(error: unknown): GenerationFailureCategory {
  if (error instanceof ProviderExecutionError) return error.category;
  if (error instanceof Error && /credit/i.test(error.message)) return 'CONFIGURATION_ERROR';
  return 'STORAGE_FAILURE';
}

function isRetryable(error: unknown): boolean {
  return error instanceof ProviderExecutionError && error.retryable;
}

function safeFailureDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return message.slice(0, 300);
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}
