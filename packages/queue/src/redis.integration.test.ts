import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { BullMqJobQueue, verifyRedisConnection } from './index.js';

const redisUrl = process.env.REDIS_URL;
const suite = redisUrl ? describe : describe.skip;

suite('Redis queue readiness', () => {
  it('connects to the configured durable queue backend without creating a job', async () => {
    const url = new URL(redisUrl as string);
    await expect(
      verifyRedisConnection({
        host: url.hostname,
        port: Number(url.port || 6379),
        ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      }),
    ).resolves.toBeUndefined();
  });

  it('retries a failed durable job once without duplicating its completed side effect', async () => {
    const url = new URL(redisUrl as string);
    const queue = new BullMqJobQueue({
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    });
    const queueName = `m10-recovery-${randomUUID()}`;
    const idempotencyKey = `m10-job-${randomUUID()}`;
    let attempts = 0;
    let completedSideEffects = 0;
    const worker = await queue.process<{ operationId: string }>(queueName, async (job) => {
      expect(job.payload.operationId).toBe('safe-operation');
      attempts += 1;
      if (attempts === 1) throw new Error('synthetic worker interruption before side effect');
      completedSideEffects += 1;
    });

    try {
      await queue.enqueue({
        queue: queueName,
        name: 'safe-operation',
        payload: { operationId: 'safe-operation' },
        options: { attempts: 2, idempotencyKey },
      });
      await waitFor(() => attempts === 2 && completedSideEffects === 1);
      expect(attempts).toBe(2);
      expect(completedSideEffects).toBe(1);
    } finally {
      await worker.close();
      await queue.close();
    }
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for durable job recovery.');
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}
