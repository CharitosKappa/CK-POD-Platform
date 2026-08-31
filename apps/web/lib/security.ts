import { createHash } from 'node:crypto';

import type { SqlPool } from '@let-it-be/db';

import { databasePool } from './platform';

export class ApiRateLimitError extends Error {
  public constructor() {
    super('Too many requests. Please wait and try again.');
  }
}

/** PostgreSQL-backed fixed-window limiter: shared across web instances and fail-closed on DB failure. */
export async function enforceRateLimit(
  request: Request,
  input: { action: string; subject?: string; maxRequests: number; windowMs: number },
): Promise<void> {
  const key = rateLimitKey(input.action, input.subject, clientIpFromRequest(request));
  await consumeRateLimit(databasePool(), key, input);
}

/**
 * A trusted reverse proxy must overwrite forwarding headers. Authenticated
 * endpoints also bind to the stable session/user subject, preventing a client
 * from evading a limit merely by presenting a different IP header.
 */
export function rateLimitKey(action: string, subject?: string, clientIp = 'unknown'): string {
  return createHash('sha256')
    .update(`${action}:${subject ?? clientIp}:${clientIp}`)
    .digest('hex');
}

export function clientIpFromRequest(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function consumeRateLimit(
  pool: SqlPool,
  key: string,
  input: Pick<Parameters<typeof enforceRateLimit>[1], 'maxRequests' | 'windowMs'>,
): Promise<void> {
  const result = await pool.query<{ request_count: number }>(
    `INSERT INTO app.api_rate_limit_buckets (bucket_key, window_started_at, request_count, updated_at)
     VALUES ($1, now(), 1, now())
     ON CONFLICT (bucket_key) DO UPDATE SET
       request_count = CASE WHEN app.api_rate_limit_buckets.window_started_at <= now() - ($2::text || ' milliseconds')::interval
         THEN 1 ELSE app.api_rate_limit_buckets.request_count + 1 END,
       window_started_at = CASE WHEN app.api_rate_limit_buckets.window_started_at <= now() - ($2::text || ' milliseconds')::interval
         THEN now() ELSE app.api_rate_limit_buckets.window_started_at END,
       updated_at = now()
     RETURNING request_count`,
    [key, String(input.windowMs)],
  );
  if ((result.rows[0]?.request_count ?? input.maxRequests + 1) > input.maxRequests)
    throw new ApiRateLimitError();
}

/** Remove expired buckets in a scheduled, bounded maintenance task; not on the hot request path. */
export async function pruneRateLimitBuckets(pool: SqlPool, olderThanMs: number): Promise<number> {
  const result = await pool.query(
    `DELETE FROM app.api_rate_limit_buckets
     WHERE updated_at < now() - ($1::text || ' milliseconds')::interval`,
    [String(olderThanMs)],
  );
  return result.rowCount ?? 0;
}
