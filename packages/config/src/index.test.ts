import { describe, expect, it } from 'vitest';

import { parseServerEnvironment } from './index.js';

const baseEnvironment = {
  DATABASE_URL: 'postgresql://letitbe:letitbe@localhost:5432/letitbe',
  REDIS_URL: 'redis://localhost:6379',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
};

describe('parseServerEnvironment', () => {
  it('uses local-safe adapter defaults', () => {
    const environment = parseServerEnvironment(baseEnvironment);

    expect(environment.STORAGE_DRIVER).toBe('memory');
    expect(environment.QUEUE_DRIVER).toBe('memory');
    expect(environment.NODE_ENV).toBe('development');
  });

  it('requires S3 credentials only when S3 is selected', () => {
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        STORAGE_DRIVER: 's3',
      }),
    ).toThrow(/S3_BUCKET/);
  });

  it('requires server-only Printify credentials only in real fulfillment mode', () => {
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        FULFILLMENT_ADAPTER: 'printify',
      }),
    ).toThrow(/PRINTIFY_API_TOKEN/);
    expect(
      parseServerEnvironment({
        ...baseEnvironment,
        FULFILLMENT_ADAPTER: 'printify',
        PRINTIFY_API_TOKEN: 'server-only-token',
        PRINTIFY_SHOP_ID: '1234',
      }).FULFILLMENT_ADAPTER,
    ).toBe('printify');
  });
});
