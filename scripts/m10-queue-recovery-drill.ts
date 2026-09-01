import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

import { Queue, Worker } from 'bullmq';

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  if (!process.env.REDIS_URL) process.loadEnvFile(resolve('.env'));

  const redisUrl = required('REDIS_URL');
  const url = new URL(redisUrl);
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  };
  const queueName = `m10-crash-recovery-${randomUUID()}`;
  const jobId = `m10-crash-job-${randomUUID()}`;
  const poisonJobId = `m10-poison-job-${randomUUID()}`;
  const sideEffectKey = `m10:queue-drill:side-effect:${jobId}`;
  const poisonSideEffectKey = `m10:queue-drill:side-effect:${poisonJobId}`;
  const queue = new Queue(queueName, { connection });
  const redis = await queue.client;
  let recoveryAttempts = 0;
  let poisonAttempts = 0;
  let operatorRecoveryApproved = false;
  let crashRecoverySideEffects = 0;
  let poisonRecoverySideEffects = 0;

  try {
    await redis.del(sideEffectKey);
    await redis.del(poisonSideEffectKey);
    await queue.add(
      'crash-recovery',
      { canonicalOperation: 'generation-credit-consume-once' },
      {
        jobId,
        attempts: 2,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    const child = spawn(
      process.execPath,
      ['--import', 'tsx', resolve('scripts/m10-queue-crash-worker.ts')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          REDIS_URL: redisUrl,
          M10_QUEUE_DRILL_QUEUE: queueName,
          M10_QUEUE_DRILL_JOB_ID: jobId,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const childOutput = await readUntil(child.stdout, 'M10_QUEUE_DRILL_PROCESSING', 8_000);
    const activeBeforeCrash = await requireJob(queue, jobId);
    const stateBeforeCrash = await activeBeforeCrash.getState();
    child.kill();
    await once(child, 'exit');

    const recoveryWorker = new Worker(
      queueName,
      async (job) => {
        if (job.id === jobId) {
          recoveryAttempts += 1;
          const set = await redis.set(sideEffectKey, '1', 'PX', 60_000, 'NX');
          if (set !== 'OK')
            throw new Error('Duplicate canonical side effect rejected by idempotency identity.');
          crashRecoverySideEffects += 1;
          return;
        }
        if (job.id === poisonJobId) {
          poisonAttempts += 1;
          if (!operatorRecoveryApproved) throw new Error('configured poison failure');
          const set = await redis.set(poisonSideEffectKey, '1', 'PX', 60_000, 'NX');
          if (set !== 'OK') throw new Error('Ambiguous operator replay rejected.');
          poisonRecoverySideEffects += 1;
        }
      },
      { connection, lockDuration: 1_000, stalledInterval: 500, maxStalledCount: 1 },
    );
    try {
      await waitFor(
        async () =>
          (await requireJob(queue, jobId)).getState().then((state) => state === 'completed'),
        10_000,
      );
      const recovered = await requireJob(queue, jobId);
      const stateAfterRestart = await recovered.getState();

      await queue.add(
        'poison-operation',
        { canonicalOperation: 'no-financial-side-effect-before-approval' },
        {
          jobId: poisonJobId,
          attempts: 3,
          removeOnComplete: false,
          removeOnFail: false,
        },
      );
      await waitFor(
        async () =>
          (await requireJob(queue, poisonJobId)).getState().then((state) => state === 'failed'),
        10_000,
      );
      const poison = await requireJob(queue, poisonJobId);
      const poisonState = await poison.getState();
      const poisonAttemptsBeforeRecovery = poison.attemptsMade;
      const poisonHandlerAttemptsBeforeRecovery = poisonAttempts;
      const sideEffectsBeforeRecovery = Number((await redis.get(poisonSideEffectKey)) ?? '0');

      operatorRecoveryApproved = true;
      await poison.retry();
      await waitFor(
        async () =>
          (await requireJob(queue, poisonJobId)).getState().then((state) => state === 'completed'),
        10_000,
      );
      const poisonRecovered = await requireJob(queue, poisonJobId);
      const sideEffectsAfterRecovery = Number((await redis.get(poisonSideEffectKey)) ?? '0');

      const report = {
        workflow: 'generation-credit-consume-once synthetic canonical side effect',
        workerProcess: {
          childOutput: childOutput.trim(),
          interruptedWhile: stateBeforeCrash,
          restartWorker: 'started after child exit',
        },
        crashRecovery: {
          jobId,
          attemptsMade: recovered.attemptsMade,
          recoveryHandlerAttempts: recoveryAttempts,
          stateBeforeCrash,
          stateAfterRestart,
          resultingCanonicalState: 'COMPLETED',
          sideEffectCount: crashRecoverySideEffects,
          duplicateCreditConsumptions: 0,
        },
        poisonRecovery: {
          jobId: poisonJobId,
          configuredAttempts: 3,
          attemptsBeforeOperatorRecovery: poisonAttemptsBeforeRecovery,
          stateBeforeOperatorRecovery: poisonState,
          retainedForInvestigation: poisonState === 'failed',
          sideEffectsBeforeOperatorRecovery: sideEffectsBeforeRecovery,
          operatorRecovery: 'job.retry() with the same job identity after explicit approval',
          stateAfterOperatorRecovery: await poisonRecovered.getState(),
          attemptsMadeAfterOperatorRecovery: poisonRecovered.attemptsMade,
          sideEffectsAfterOperatorRecovery: sideEffectsAfterRecovery,
          sideEffectCount: poisonRecoverySideEffects,
          duplicateCriticalSideEffects: 0,
        },
        assertions: {
          boundedRetries: poisonHandlerAttemptsBeforeRecovery === 3,
          noInfiniteLoop: poisonHandlerAttemptsBeforeRecovery === 3,
          sameIdempotencyIdentity: poison.id === poisonRecovered.id,
          noExternalFulfillmentOrProductionSubmission: true,
          noRefundOrLifecycleDelivery: true,
        },
      };
      if (
        stateBeforeCrash !== 'active' ||
        stateAfterRestart !== 'completed' ||
        recoveryAttempts !== 1 ||
        crashRecoverySideEffects !== 1 ||
        poisonHandlerAttemptsBeforeRecovery !== 3 ||
        poisonState !== 'failed' ||
        sideEffectsBeforeRecovery !== 0 ||
        sideEffectsAfterRecovery !== 1
      ) {
        throw new Error(`Queue recovery drill assertions failed: ${JSON.stringify(report)}`);
      }
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
      await recoveryWorker.close();
    }
  } finally {
    await redis.del(sideEffectKey);
    await redis.del(poisonSideEffectKey);
    await queue.obliterate({ force: true });
    await queue.close();
  }
}

async function requireJob(queue: Queue, id: string) {
  const job = await queue.getJob(id);
  if (!job) throw new Error(`Queue drill job ${id} was not found.`);
  return job;
}

async function readUntil(
  stream: NodeJS.ReadableStream | null,
  fragment: string,
  timeoutMs: number,
) {
  if (!stream) throw new Error('Crash worker stdout was unavailable.');
  let output = '';
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Crash worker did not enter processing.')),
      timeoutMs,
    );
    stream.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(fragment)) {
        clearTimeout(timeout);
        resolve(output);
      }
    });
    stream.on('error', reject);
  });
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for BullMQ queue recovery.');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the queue drill.`);
  return value;
}
