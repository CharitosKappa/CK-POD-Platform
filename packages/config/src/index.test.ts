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
    expect(environment.AUTH_EMAIL_CODE_ADAPTER).toBe('local');
  });

  it('treats blank optional local provider and observability fields as absent', () => {
    expect(
      parseServerEnvironment({
        ...baseEnvironment,
        OPENAI_API_KEY: '',
        OTEL_EXPORTER_OTLP_ENDPOINT: '',
        S3_BUCKET: '',
        S3_ENDPOINT: '',
        S3_ACCESS_KEY_ID: '',
        S3_SECRET_ACCESS_KEY: '',
      }),
    ).toMatchObject({
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      OPENAI_API_KEY: undefined,
      S3_BUCKET: undefined,
      S3_ENDPOINT: undefined,
    });
  });

  it('activates the Sunburst image provider only when a server-side OpenAI key is present', () => {
    const environment = parseServerEnvironment({
      ...baseEnvironment,
      OPENAI_API_KEY: 'server-only-key',
      OPENAI_IMAGE_MODEL: 'gpt-image-2.5-sunburst',
    });

    expect(environment.OPENAI_API_KEY).toBe('server-only-key');
    expect(environment.OPENAI_IMAGE_MODEL).toBe('gpt-image-2.5-sunburst');
    expect(environment.OPENAI_API_BASE_URL).toBe('https://api.openai.com/v1');
    expect(JSON.parse(environment.AI_PROVIDER_CONFIG)[0]).toMatchObject({
      id: 'openai-sunburst',
      adapter: 'openai-images',
      enabled: true,
      tasks: ['TEXT_TO_ARTWORK'],
      model: 'gpt-image-2.5-sunburst',
      priority: 1,
      maxRetries: 0,
      fallbackEligible: false,
    });
  });

  it('preserves an explicit AI provider routing configuration when an OpenAI key is present', () => {
    const explicit = JSON.stringify([
      {
        id: 'explicit-primary',
        adapter: 'deterministic-svg',
        enabled: true,
        tasks: ['TEXT_TO_ARTWORK'],
        model: 'explicit-v1',
        priority: 1,
        estimatedCostCents: 0,
        timeoutMs: 1000,
        maxRetries: 0,
        fallbackEligible: false,
      },
      {
        id: 'explicit-secondary',
        adapter: 'deterministic-pattern',
        enabled: true,
        tasks: ['TEXT_TO_ARTWORK'],
        model: 'explicit-v2',
        priority: 2,
        estimatedCostCents: 0,
        timeoutMs: 1000,
        maxRetries: 0,
        fallbackEligible: false,
      },
    ]);
    const environment = parseServerEnvironment({
      ...baseEnvironment,
      OPENAI_API_KEY: 'server-only-key',
      AI_PROVIDER_CONFIG: explicit,
    });

    expect(environment.AI_PROVIDER_CONFIG).toBe(explicit);
  });

  it('allows Flare as an explicit temporary image-model override', () => {
    const environment = parseServerEnvironment({
      ...baseEnvironment,
      OPENAI_API_KEY: 'server-only-key',
      OPENAI_IMAGE_MODEL: 'gpt-image-2.5-flare',
    });

    expect(environment.OPENAI_IMAGE_MODEL).toBe('gpt-image-2.5-flare');
    expect(JSON.parse(environment.AI_PROVIDER_CONFIG)[0]).toMatchObject({
      adapter: 'openai-images',
      model: 'gpt-image-2.5-flare',
      maxRetries: 0,
    });
  });

  it('rejects image models outside the approved GPT-Image 2.5 pair', () => {
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        OPENAI_IMAGE_MODEL: 'unapproved-image-model',
      }),
    ).toThrow();
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
        AUTH_EMAIL_CODE_ADAPTER: 'transactional',
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
    ['local email code adapter', { AUTH_EMAIL_CODE_ADAPTER: 'local' }, /AUTH_EMAIL_CODE_ADAPTER/],
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
    ['AUTH_EMAIL_CODE_ADAPTER', 'unknown-email'],
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
    AUTH_EMAIL_CODE_ADAPTER: 'transactional',
  };
}
