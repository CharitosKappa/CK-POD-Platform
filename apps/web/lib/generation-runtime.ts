import type { ServerEnvironment } from '@let-it-be/config';
import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import {
  createGenerationRuntime,
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

import { serverEnvironment } from './runtime-environment';

interface WebGenerationRuntime {
  runtime: ReturnType<typeof createGenerationRuntime>;
  queue: BackgroundJobQueue;
  storage: PrivateObjectStorage;
}

declare global {
  var letItBeGenerationRuntime: Promise<WebGenerationRuntime> | undefined;
}

export async function generationRuntime(): Promise<WebGenerationRuntime> {
  if (!globalThis.letItBeGenerationRuntime) {
    globalThis.letItBeGenerationRuntime = createRuntime();
  }
  return globalThis.letItBeGenerationRuntime;
}

async function createRuntime(): Promise<WebGenerationRuntime> {
  const environment = serverEnvironment();
  const pool: SqlPool = createDatabaseClient(environment.DATABASE_URL).pool;
  const queue = createQueue(environment.QUEUE_DRIVER, environment.REDIS_URL);
  const storage = createStorage(environment);
  const runtime = createGenerationRuntime({
    pool,
    queue,
    storage,
    logger: createLogger({ service: 'web-ai', minimumLevel: environment.LOG_LEVEL }),
    providerConfiguration: environment.AI_PROVIDER_CONFIG,
    guestFreeCredits: environment.AI_GUEST_FREE_CREDITS,
    registeredFreeCredits: environment.AI_REGISTERED_FREE_CREDITS,
    maxReferenceAssets: environment.AI_MAX_REFERENCE_ASSETS,
  });
  if (environment.QUEUE_DRIVER === 'memory') {
    await startGenerationConsumer(queue, (generationId) => runtime.worker.process(generationId));
    await startPrepressConsumer(queue, (prepressRunId) => runtime.prepress.process(prepressRunId));
  }
  return { runtime, queue, storage };
}

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

function createStorage(environment: ServerEnvironment): PrivateObjectStorage {
  if (environment.STORAGE_DRIVER === 'memory') return new MemoryObjectStorage();
  return new S3PrivateObjectStorage({
    bucket: environment.S3_BUCKET as string,
    clientConfig: {
      region: environment.S3_REGION,
      ...(environment.S3_ENDPOINT ? { endpoint: environment.S3_ENDPOINT } : {}),
      credentials: {
        accessKeyId: environment.S3_ACCESS_KEY_ID as string,
        secretAccessKey: environment.S3_SECRET_ACCESS_KEY as string,
      },
    },
  });
}
