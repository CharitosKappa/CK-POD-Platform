import { parseServerEnvironment } from '@let-it-be/config';
import { verifyRedisConnection } from '@let-it-be/queue';
import { NextResponse } from 'next/server';

import { databasePool } from '../../../lib/platform';

export const dynamic = 'force-dynamic';

/** Readiness is intentionally stricter than liveness: the database is required to serve traffic. */
export async function GET(): Promise<NextResponse> {
  try {
    const environment = parseServerEnvironment(process.env);
    await databasePool().query('SELECT 1');
    if (environment.QUEUE_DRIVER === 'redis') {
      const redis = new URL(environment.REDIS_URL);
      await verifyRedisConnection({
        host: redis.hostname,
        port: Number(redis.port || 6379),
        ...(redis.username ? { username: decodeURIComponent(redis.username) } : {}),
        ...(redis.password ? { password: decodeURIComponent(redis.password) } : {}),
      });
    }
    return NextResponse.json({
      status: 'ready',
      dependencies: {
        database: 'ready',
        queue: environment.QUEUE_DRIVER === 'redis' ? 'configured' : 'local-only',
        lifecycle:
          environment.LIFECYCLE_ADAPTER === 'klaviyo' ? 'non-critical' : 'disabled-or-fake',
      },
    });
  } catch {
    return NextResponse.json({ status: 'not_ready' }, { status: 503 });
  }
}
