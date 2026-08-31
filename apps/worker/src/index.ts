import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

import { parseServerEnvironment } from '@let-it-be/config';
import { createDatabaseClient } from '@let-it-be/db';
import {
  createGenerationRuntime,
  FakeLifecycleMessagingService,
  KlaviyoLifecycleMessagingService,
  LifecycleOrchestrator,
  startGenerationConsumer,
  startPrepressConsumer,
} from '@let-it-be/domain';
import { createLogger } from '@let-it-be/observability';
import { BullMqJobQueue, InMemoryJobQueue, type BackgroundJobQueue } from '@let-it-be/queue';
import {
  MemoryObjectStorage,
  S3PrivateObjectStorage,
  type PrivateObjectStorage,
} from '@let-it-be/storage';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const environment = parseServerEnvironment(process.env);
const logger = createLogger({
  service: 'worker',
  minimumLevel: environment.LOG_LEVEL,
});

logger.info('worker.ready', {
  environment: environment.APP_ENV,
  queueDriver: environment.QUEUE_DRIVER,
});

const queue = createQueue(environment.QUEUE_DRIVER, environment.REDIS_URL);
const database = createDatabaseClient(environment.DATABASE_URL);
const runtime = createGenerationRuntime({
  pool: database.pool,
  queue,
  storage: createStorage(environment),
  logger,
  providerConfiguration: environment.AI_PROVIDER_CONFIG,
  guestFreeCredits: environment.AI_GUEST_FREE_CREDITS,
  registeredFreeCredits: environment.AI_REGISTERED_FREE_CREDITS,
  maxReferenceAssets: environment.AI_MAX_REFERENCE_ASSETS,
});

await startGenerationConsumer(queue, (generationId) => runtime.worker.process(generationId));
logger.info('worker.generation_consumer_ready', { queue: 'ai-generation' });
await startPrepressConsumer(queue, (prepressRunId) => runtime.prepress.process(prepressRunId));
logger.info('worker.prepress_consumer_ready', { queue: 'prepress-render' });

const lifecycle = new LifecycleOrchestrator(
  database.pool,
  environment.LIFECYCLE_ADAPTER === 'klaviyo'
    ? new KlaviyoLifecycleMessagingService(
        environment.KLAVIYO_API_KEY!,
        environment.KLAVIYO_API_BASE_URL,
      )
    : new FakeLifecycleMessagingService(),
  environment.LIFECYCLE_ADAPTER === 'klaviyo' ? 'KLAVIYO' : 'FAKE',
);
async function processLifecycle(): Promise<void> {
  try {
    await lifecycle.processAbandonment({
      generatedNoPurchaseDelayMs: environment.LIFECYCLE_GENERATED_NO_PURCHASE_DELAY_MS,
      cartDelayMs: environment.LIFECYCLE_CART_ABANDONMENT_DELAY_MS,
      checkoutDelayMs: environment.LIFECYCLE_CHECKOUT_ABANDONMENT_DELAY_MS,
    });
    await lifecycle.processReorderRevisit({
      delayMs: environment.LIFECYCLE_REORDER_REVISIT_DELAY_MS,
    });
  } catch (error) {
    logger.error('worker.lifecycle_processing_failed', {
      error: error instanceof Error ? error.message : 'unknown lifecycle processing error',
    });
  }
}
void processLifecycle();
setInterval(() => void processLifecycle(), environment.LIFECYCLE_PROCESS_INTERVAL_MS).unref();
logger.info('worker.lifecycle_processor_ready', { adapter: environment.LIFECYCLE_ADAPTER });

function createQueue(driver: 'memory' | 'redis', redisUrl: string): BackgroundJobQueue {
  if (driver === 'memory') return new InMemoryJobQueue();
  const url = new URL(redisUrl);
  return new BullMqJobQueue({
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  });
}

function createStorage(input: ReturnType<typeof parseServerEnvironment>): PrivateObjectStorage {
  if (input.STORAGE_DRIVER === 'memory') return new MemoryObjectStorage();
  return new S3PrivateObjectStorage({
    bucket: input.S3_BUCKET as string,
    clientConfig: {
      region: input.S3_REGION,
      ...(input.S3_ENDPOINT ? { endpoint: input.S3_ENDPOINT } : {}),
      credentials: {
        accessKeyId: input.S3_ACCESS_KEY_ID as string,
        secretAccessKey: input.S3_SECRET_ACCESS_KEY as string,
      },
    },
  });
}
