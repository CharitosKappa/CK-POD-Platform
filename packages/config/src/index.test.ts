import { describe, expect, it } from 'vitest';

import { operationalCapability, parseServerEnvironment } from './index.js';

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
    expect(environment.SESSION_COOKIE_SECURE).toBe(false);
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

  it('fails closed for dangerous production adapter and cookie settings', () => {
    expect(() =>
      parseServerEnvironment({ ...baseEnvironment, APP_ENV: 'production', NODE_ENV: 'production' }),
    ).toThrow(/STORAGE_DRIVER=s3/);
    expect(
      parseServerEnvironment({
        ...baseEnvironment,
        APP_ENV: 'production',
        NODE_ENV: 'production',
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'private-assets',
        S3_ACCESS_KEY_ID: 'key',
        S3_SECRET_ACCESS_KEY: 'secret',
        QUEUE_DRIVER: 'redis',
        PAYMENT_ADAPTER: 'stripe',
        STRIPE_SECRET_KEY: 'stripe-secret',
        STRIPE_PUBLISHABLE_KEY: 'stripe-public',
        STRIPE_WEBHOOK_SECRET: 'stripe-webhook',
        TAX_ADAPTER: 'stripe',
        FULFILLMENT_ADAPTER: 'printify',
        PRINTIFY_API_TOKEN: 'printify-token',
        PRINTIFY_SHOP_ID: 'shop',
        PRINTIFY_WEBHOOK_SECRET: 'printify-webhook',
        SESSION_COOKIE_SECURE: 'true',
      }).SESSION_COOKIE_SECURE,
    ).toBe(true);
  });

  it.each([
    ['fake payment', { PAYMENT_ADAPTER: 'fake' }, /PAYMENT_ADAPTER=stripe/],
    ['fake fulfillment', { FULFILLMENT_ADAPTER: 'fake' }, /FULFILLMENT_ADAPTER=printify/],
    ['missing Stripe webhook secret', { STRIPE_WEBHOOK_SECRET: '' }, /STRIPE_WEBHOOK_SECRET/],
    ['missing Printify webhook secret', { PRINTIFY_WEBHOOK_SECRET: '' }, /PRINTIFY_WEBHOOK_SECRET/],
    ['missing Printify credentials', { PRINTIFY_API_TOKEN: '' }, /PRINTIFY_API_TOKEN/],
    ['insecure cookies', { SESSION_COOKIE_SECURE: 'false' }, /SESSION_COOKIE_SECURE=true/],
    ['unsafe memory storage', { STORAGE_DRIVER: 'memory' }, /STORAGE_DRIVER=s3/],
    ['missing durable queue', { QUEUE_DRIVER: 'memory' }, /QUEUE_DRIVER=redis/],
  ])('rejects production %s', (_name, override, expected) => {
    expect(() => parseServerEnvironment({ ...productionEnvironment(), ...override })).toThrow(
      expected,
    );
  });

  it('keeps explicit operational kill switches separate from adapter safety', () => {
    const environment = parseServerEnvironment({
      ...baseEnvironment,
      GENERATION_ENABLED: 'false',
      CHECKOUT_ENABLED: 'false',
      LIFECYCLE_MARKETING_ENABLED: 'false',
    });
    expect(environment).toMatchObject({
      GENERATION_ENABLED: false,
      CHECKOUT_ENABLED: false,
      LIFECYCLE_MARKETING_ENABLED: false,
      PRINTIFY_PRODUCTION_SUBMISSION_ENABLED: false,
    });
  });

  it.each([
    ['GENERATION_ENABLED', 'true', true],
    ['GENERATION_ENABLED', 'false', false],
    ['CHECKOUT_ENABLED', 'true', true],
    ['CHECKOUT_ENABLED', 'false', false],
    ['PRINTIFY_PRODUCTION_SUBMISSION_ENABLED', 'true', true],
    ['PRINTIFY_PRODUCTION_SUBMISSION_ENABLED', 'false', false],
    ['LIFECYCLE_MARKETING_ENABLED', 'true', true],
    ['LIFECYCLE_MARKETING_ENABLED', 'false', false],
    ['SESSION_COOKIE_SECURE', 'true', true],
    ['SESSION_COOKIE_SECURE', 'false', false],
  ])('parses documented boolean %s=%s explicitly', (key, value, expected) => {
    const environment = parseServerEnvironment({ ...baseEnvironment, [key]: value });
    expect((environment as Record<string, unknown>)[key]).toBe(expected);
  });

  it.each(['FALSEE', '0abc', 'yesplease', '1', '0', 'TRUE', 'False', ''])(
    'rejects malformed boolean values rather than relying on truthiness: %s',
    (value) => {
      expect(() =>
        parseServerEnvironment({ ...baseEnvironment, GENERATION_ENABLED: value }),
      ).toThrow();
    },
  );

  it.each([
    ['PAYMENT_ADAPTER', 'unknown-payment'],
    ['FULFILLMENT_ADAPTER', 'unknown-fulfillment'],
    ['STORAGE_DRIVER', 'public-http'],
    ['QUEUE_DRIVER', 'sqs'],
    ['LIFECYCLE_ADAPTER', 'unknown-lifecycle'],
    ['TAX_ADAPTER', 'unknown-tax'],
    ['APP_ENV', 'prod'],
    ['NODE_ENV', 'prod'],
  ])('rejects unknown allowlisted configuration %s=%s', (key, value) => {
    expect(() => parseServerEnvironment({ ...baseEnvironment, [key]: value })).toThrow();
  });

  it('turns parsed kill switches into explicit operational denial states', () => {
    const disabled = parseServerEnvironment({
      ...baseEnvironment,
      GENERATION_ENABLED: 'false',
      CHECKOUT_ENABLED: 'false',
      LIFECYCLE_MARKETING_ENABLED: 'false',
    });
    expect(operationalCapability(disabled, 'GENERATION')).toEqual({
      enabled: false,
      message: 'Generation is temporarily unavailable.',
    });
    expect(operationalCapability(disabled, 'CHECKOUT_CREATION')).toMatchObject({
      enabled: false,
    });
    expect(operationalCapability(disabled, 'LIFECYCLE_MARKETING')).toMatchObject({
      enabled: false,
    });
    expect(operationalCapability(disabled, 'PRODUCTION_SUBMISSION')).toMatchObject({
      enabled: false,
    });
    const productionEnabled = parseServerEnvironment({
      ...productionEnvironment(),
      PRINTIFY_PRODUCTION_SUBMISSION_ENABLED: 'true',
    });
    expect(operationalCapability(productionEnabled, 'PRODUCTION_SUBMISSION')).toMatchObject({
      enabled: true,
    });
  });
});

function productionEnvironment() {
  return {
    ...baseEnvironment,
    APP_ENV: 'production',
    NODE_ENV: 'production',
    STORAGE_DRIVER: 's3',
    S3_BUCKET: 'private-assets',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
    QUEUE_DRIVER: 'redis',
    PAYMENT_ADAPTER: 'stripe',
    STRIPE_SECRET_KEY: 'stripe-secret',
    STRIPE_PUBLISHABLE_KEY: 'stripe-public',
    STRIPE_WEBHOOK_SECRET: 'stripe-webhook',
    TAX_ADAPTER: 'stripe',
    FULFILLMENT_ADAPTER: 'printify',
    PRINTIFY_API_TOKEN: 'printify-token',
    PRINTIFY_SHOP_ID: 'shop',
    PRINTIFY_WEBHOOK_SECRET: 'printify-webhook',
    SESSION_COOKIE_SECURE: 'true',
  };
}
