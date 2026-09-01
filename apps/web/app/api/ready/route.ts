import { createLogger, parseLogLevel } from '@let-it-be/observability';
import { verifyRedisConnection } from '@let-it-be/queue';
import { NextResponse } from 'next/server';

import { databasePool } from '../../../lib/platform';
import { serverEnvironment } from '../../../lib/runtime-environment';

export const dynamic = 'force-dynamic';
const logger = createLogger({ service: 'web', minimumLevel: parseLogLevel(process.env.LOG_LEVEL) });

/** Readiness is intentionally stricter than liveness: the database is required to serve traffic. */
export async function GET(): Promise<NextResponse> {
  try {
    const environment = serverEnvironment();
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
  } catch (error) {
    logger.error('readiness.failed', {
      failureClass: error instanceof Error ? error.name : 'unknown',
      failureCode:
        error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unclassified',
      failureFields:
        error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)
          ? error.issues.map((issue) => String(issue.path?.[0] ?? 'root'))
          : [],
    });
    return NextResponse.json({ status: 'not_ready' }, { status: 503 });
  }
}
