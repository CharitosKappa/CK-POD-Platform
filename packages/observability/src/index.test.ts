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
      prompt: 'private artwork prompt',
      customerEmail: 'customer@example.test',
      productionMasterAssetId: 'private-master',
      shippingAddress: { line1: '1 Private Street' },
      storageKey: 'generations/private/source.svg',
      signedUrl: 'https://storage.example/private?signature=secret',
      webhookSignature: 'signature',
      paymentMetadata: { card: 'sensitive' },
      requestId: 'request-safe',
      generationId: 'generation-safe',
      orderId: 'order-safe',
      jobId: 'job-safe',
      externalActionId: 'external-safe',
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
          prompt: '[REDACTED]',
          customerEmail: '[REDACTED]',
          productionMasterAssetId: '[REDACTED]',
          shippingAddress: '[REDACTED]',
          storageKey: '[REDACTED]',
          signedUrl: '[REDACTED]',
          webhookSignature: '[REDACTED]',
          paymentMetadata: '[REDACTED]',
          requestId: 'request-safe',
          generationId: 'generation-safe',
          orderId: 'order-safe',
          jobId: 'job-safe',
          externalActionId: 'external-safe',
        },
      }),
    ]);
  });
});
