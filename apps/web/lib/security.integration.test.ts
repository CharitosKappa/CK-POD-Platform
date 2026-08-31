import { randomBytes } from 'node:crypto';

import { createDatabaseClient } from '@let-it-be/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ApiRateLimitError,
  consumeRateLimit,
  pruneRateLimitBuckets,
  rateLimitKey,
} from './security.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;
const integrationSuite = integrationDatabaseUrl ? describe : describe.skip;

integrationSuite('distributed API rate limiting', () => {
  let close: () => Promise<void>;
  let pool: ReturnType<typeof createDatabaseClient>['pool'];

  beforeAll(() => {
    const database = createDatabaseClient(integrationDatabaseUrl as string);
    pool = database.pool;
    close = database.close;
  });

  afterAll(async () => close());

  it('enforces an atomic shared limit under concurrent callers', async () => {
    const key = `m10-rate-${randomBytes(8).toString('hex')}`;
    const results = await Promise.allSettled([
      consumeRateLimit(pool, key, { maxRequests: 1, windowMs: 60_000 }),
      consumeRateLimit(pool, key, { maxRequests: 1, windowMs: 60_000 }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason).toBeInstanceOf(
      ApiRateLimitError,
    );
  });

  it('expires and prunes inactive buckets outside the request path', async () => {
    const key = `m10-expired-${randomBytes(8).toString('hex')}`;
    await consumeRateLimit(pool, key, { maxRequests: 2, windowMs: 60_000 });
    await pool.query(
      `UPDATE app.api_rate_limit_buckets SET updated_at = now() - interval '2 days' WHERE bucket_key = $1`,
      [key],
    );
    expect(await pruneRateLimitBuckets(pool, 24 * 60 * 60_000)).toBeGreaterThanOrEqual(1);
    expect(
      await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.api_rate_limit_buckets WHERE bucket_key = $1`,
        [key],
      ),
    ).toMatchObject({ rows: [{ count: '0' }] });
  });

  it('binds authenticated limits to the stable subject while keeping guests IP-scoped', () => {
    expect(rateLimitKey('generation', 'session-a', '198.51.100.1')).not.toBe(
      rateLimitKey('generation', 'session-a', '198.51.100.2'),
    );
    expect(rateLimitKey('generation', 'session-a', '198.51.100.1')).not.toBe(
      rateLimitKey('generation', 'session-b', '198.51.100.1'),
    );
    expect(rateLimitKey('login', undefined, '198.51.100.1')).toBe(
      rateLimitKey('login', undefined, '198.51.100.1'),
    );
  });

  it('fails closed when the distributed rate-limit database boundary is unavailable', async () => {
    const unavailablePool = {
      query: async () => {
        throw new Error('database unavailable');
      },
    };
    await expect(
      consumeRateLimit(unavailablePool as never, 'm10-db-unavailable', {
        maxRequests: 1,
        windowMs: 60_000,
      }),
    ).rejects.toThrow('database unavailable');
  });
});
