import { randomUUID } from 'node:crypto';

import { createDatabaseClient } from '@let-it-be/db';

import { consumeRateLimit } from '../apps/web/lib/security.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');

const total = Number(process.env.M10_MIXED_LOAD_REQUESTS ?? 100);
const concurrency = Number(process.env.M10_MIXED_LOAD_CONCURRENCY ?? 10);
if (!Number.isInteger(total) || total < 1 || !Number.isInteger(concurrency) || concurrency < 1)
  throw new Error('M10 mixed-load request and concurrency values must be positive integers.');

const database = createDatabaseClient(connectionString);
const prefix = `m10-mixed-${randomUUID()}`;
const latencies: number[] = [];
let next = 0;
let failures = 0;
const started = performance.now();

async function execute(index: number): Promise<void> {
  switch (index % 5) {
    case 0:
      await database.pool.query(`SELECT count(*)::int AS count FROM app.projects`);
      return;
    case 1:
      await consumeRateLimit(database.pool, `${prefix}-${index}`, {
        maxRequests: 2,
        windowMs: 60_000,
      });
      return;
    case 2:
      await database.pool.query(
        `SELECT status, count(*)::int AS count FROM app.checkout_attempts GROUP BY status`,
      );
      return;
    case 3:
      await database.pool.query(
        `SELECT event_name, count(*)::int AS count FROM app.payment_events GROUP BY event_name`,
      );
      return;
    default:
      await database.pool.query(
        `SELECT status, count(*)::int AS count FROM app.orders GROUP BY status`,
      );
  }
}

async function worker(): Promise<void> {
  while (true) {
    const index = next++;
    if (index >= total) return;
    const began = performance.now();
    try {
      await execute(index);
    } catch {
      failures += 1;
    } finally {
      latencies.push(performance.now() - began);
    }
  }
}

async function main(): Promise<void> {
  try {
    await Promise.all(Array.from({ length: Math.min(total, concurrency) }, () => worker()));
    latencies.sort((left, right) => left - right);
    const percentile = (value: number) =>
      latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * value) - 1)] ?? 0;
    console.info(
      JSON.stringify({
        scenario: 'postgres_mixed_read_and_rate_limit_smoke',
        operations: [
          'ordinary-project-query',
          'generation-rate-limit',
          'checkout-query',
          'webhook-query',
          'ops-query',
        ],
        total,
        concurrency: Math.min(total, concurrency),
        errorRate: failures / total,
        elapsedMs: Math.round(performance.now() - started),
        p50Ms: Number(percentile(0.5).toFixed(2)),
        p95Ms: Number(percentile(0.95).toFixed(2)),
        p99Ms: Number(percentile(0.99).toFixed(2)),
        memoryRssBytes: process.memoryUsage().rss,
      }),
    );
  } finally {
    await database.pool.query(`DELETE FROM app.api_rate_limit_buckets WHERE bucket_key LIKE $1`, [
      `${prefix}%`,
    ]);
    await database.close();
  }
}

void main();
