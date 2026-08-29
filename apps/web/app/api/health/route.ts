import { createLogger, parseLogLevel } from '@let-it-be/observability';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  createLogger({
    service: 'web',
    minimumLevel: parseLogLevel(process.env.LOG_LEVEL),
  }).info('healthcheck.requested');

  return NextResponse.json({ status: 'ok' });
}
