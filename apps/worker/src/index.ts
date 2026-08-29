import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

import { parseServerEnvironment } from '@let-it-be/config';
import { createLogger } from '@let-it-be/observability';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const environment = parseServerEnvironment(process.env);
const logger = createLogger({
  service: 'worker',
  minimumLevel: environment.LOG_LEVEL,
});

logger.info('worker.ready', {
  environment: environment.APP_ENV,
  queueDriver: environment.QUEUE_DRIVER,
});

/**
 * Domain job consumers are intentionally added by their owning milestones.
 * This executable proves the separate worker runtime exists without starting
 * work that belongs to Milestone 1 or later.
 */
