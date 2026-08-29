import { describe, expect, it } from 'vitest';

import { createLogger } from './index.js';

describe('createLogger', () => {
  it('emits structured records and redacts nested secrets', () => {
    const records: unknown[] = [];
    const logger = createLogger({
      service: 'test-service',
      minimumLevel: 'debug',
      write: (record) => records.push(record),
    });

    logger.info('foundation.check', {
      correlationId: 'correlation-1',
      authorization: 'Bearer sensitive',
      provider: { apiKey: 'sensitive' },
    });

    expect(records).toEqual([
      expect.objectContaining({
        level: 'info',
        service: 'test-service',
        event: 'foundation.check',
        context: {
          correlationId: 'correlation-1',
          authorization: '[REDACTED]',
          provider: { apiKey: '[REDACTED]' },
        },
      }),
    ]);
  });
});
