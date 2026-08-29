import { createLogger, parseLogLevel } from '@let-it-be/observability';

export async function register(): Promise<void> {
  createLogger({
    service: 'web',
    minimumLevel: parseLogLevel(process.env.LOG_LEVEL),
  }).info('application.instrumented', {
    runtime: process.env.NEXT_RUNTIME ?? 'nodejs',
  });
}
