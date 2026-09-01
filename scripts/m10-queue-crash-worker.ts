import { Worker } from 'bullmq';

const queueName = required('M10_QUEUE_DRILL_QUEUE');
const redisUrl = required('REDIS_URL');
const jobId = required('M10_QUEUE_DRILL_JOB_ID');
const url = new URL(redisUrl);
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
  ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
};

const worker = new Worker(
  queueName,
  async (job) => {
    if (job.id !== jobId) throw new Error('Unexpected queue drill job.');
    process.stdout.write(`M10_QUEUE_DRILL_PROCESSING ${job.id}\n`);
    // The parent terminates this real child worker while this handler holds the lock.
    await new Promise<void>(() => undefined);
  },
  { connection, lockDuration: 1_000, stalledInterval: 500, maxStalledCount: 1 },
);
worker.on('error', (error) =>
  process.stderr.write(`M10_QUEUE_DRILL_WORKER_ERROR ${error.message}\n`),
);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the queue drill.`);
  return value;
}
