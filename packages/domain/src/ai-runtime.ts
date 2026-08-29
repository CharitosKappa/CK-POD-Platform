import type { SqlPool } from '@let-it-be/db';
import type { AppLogger } from '@let-it-be/observability';
import type { BackgroundJobQueue } from '@let-it-be/queue';
import type { PrivateObjectStorage } from '@let-it-be/storage';

import type {
  GenerationModerationService,
  GenerationRateLimiter,
  GenerationValidationService,
  PromptPipeline,
} from './ai-contracts';
import { createConfiguredProviderRegistry, parseProviderConfigurations } from './ai-providers';
import { CreditService } from './credits';
import { GenerationWorkerService } from './generation-worker';
import { GenerationService } from './generations';
import {
  AllowAllDevelopmentModeration,
  AllowAllDevelopmentValidation,
  AllowAllGenerationRateLimiter,
  DefaultPromptPipeline,
} from './prompt-pipeline';

export interface GenerationRuntimeOptions {
  pool: SqlPool;
  queue: BackgroundJobQueue;
  storage: PrivateObjectStorage;
  logger: AppLogger;
  providerConfiguration: string;
  guestFreeCredits: number;
  registeredFreeCredits: number;
  maxReferenceAssets: number;
  moderation?: GenerationModerationService;
  validation?: GenerationValidationService;
  promptPipeline?: PromptPipeline;
  rateLimiter?: GenerationRateLimiter;
}

export function createGenerationRuntime(options: GenerationRuntimeOptions) {
  const credits = new CreditService(options.pool, {
    guestFreeCredits: options.guestFreeCredits,
    registeredFreeCredits: options.registeredFreeCredits,
  });
  const providers = createConfiguredProviderRegistry(
    parseProviderConfigurations(options.providerConfiguration),
  );
  const generations = new GenerationService(
    options.pool,
    options.queue,
    credits,
    options.promptPipeline ?? new DefaultPromptPipeline(),
    options.rateLimiter ?? new AllowAllGenerationRateLimiter(),
    { maxReferenceAssets: options.maxReferenceAssets },
  );
  const worker = new GenerationWorkerService(
    options.pool,
    generations,
    credits,
    providers,
    options.storage,
    options.moderation ?? new AllowAllDevelopmentModeration(),
    options.validation ?? new AllowAllDevelopmentValidation(),
    options.logger,
  );
  return { credits, providers, generations, worker };
}
