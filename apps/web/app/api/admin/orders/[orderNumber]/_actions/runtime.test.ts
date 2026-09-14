import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Domain from '@let-it-be/domain';
const setup = vi.hoisted(() => ({
  environment: vi.fn(),
  fulfillment: vi.fn(),
  storage: { fixture: 'storage' },
}));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('../../../../../../lib/runtime-environment', () => ({
  serverEnvironment: setup.environment,
}));
vi.mock('../../../../../../lib/generation-runtime', () => ({
  generationRuntime: async () => ({ storage: setup.storage }),
}));
vi.mock('@let-it-be/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof Domain>();
  return {
    ...actual,
    createFulfillmentAdapter: setup.fulfillment,
    OrderAdminActionsService: class {
      constructor(
        public pool: unknown,
        public dependencies: unknown,
      ) {}
    },
    OrderRefundService: class {
      constructor(
        public pool: unknown,
        public payments: unknown,
      ) {}
    },
    OrderOperationsService: class {
      constructor(
        public pool: unknown,
        public storage: unknown,
        public fulfillment: unknown,
        public configuration: unknown,
        public unused: unknown,
        public lifecycle: unknown,
      ) {}
    },
    OrderRepricingService: class {
      constructor(
        public pool: unknown,
        public taxes: unknown,
        public configuration: unknown,
      ) {}
    },
  };
});
import * as platform from '../../../../../../lib/platform';
import {
  FakePaymentService,
  FakeTaxService,
  StripePaymentService,
  StripeTaxService,
} from '@let-it-be/domain';

describe('Order action runtime dependencies', () => {
  afterEach(() => {
    globalThis.letItBePool = undefined;
    vi.resetAllMocks();
  });
  for (const live of [false, true])
    it(
      'uses the configured ' + (live ? 'live' : 'fake') + ' adapters and shared dependencies',
      async () => {
        const pool = { query: vi.fn(), connect: vi.fn(), end: vi.fn() };
        globalThis.letItBePool = pool as never;
        const fulfillment = { fixture: 'fulfillment' };
        setup.fulfillment.mockReturnValue(fulfillment);
        setup.environment.mockReturnValue({
          APP_ENV: 'development',
          FULFILLMENT_ADAPTER: live ? 'printify' : 'fake',
          PRINTIFY_API_BASE_URL: 'https://printify.test',
          PRINTIFY_API_TOKEN: 'private-token',
          PRINTIFY_SHOP_ID: 'shop',
          PAYMENT_ADAPTER: live ? 'stripe' : 'fake',
          TAX_ADAPTER: live ? 'stripe' : 'fake',
          STRIPE_SECRET_KEY: 'private-stripe',
          STRIPE_WEBHOOK_SECRET: 'private-webhook',
          STRIPE_API_BASE_URL: 'https://stripe.test',
          DEVELOPMENT_TAX_RATE_BASIS_POINTS: 725,
          LIFECYCLE_ADAPTER: 'fake',
        });
        expect(platform).toHaveProperty('orderAdminActionsRuntime');
        const runtime = await (
          platform as unknown as {
            orderAdminActionsRuntime: () => Promise<{
              actions: {
                pool: unknown;
                dependencies: {
                  operations: {
                    pool: unknown;
                    storage: unknown;
                    fulfillment: unknown;
                    lifecycle: unknown;
                  };
                  fulfillment: unknown;
                  refunds: unknown;
                  lifecycle: unknown;
                  repricing: {
                    pool: unknown;
                    taxes: unknown;
                    configuration: { developmentProviderOnly: boolean };
                  };
                };
              };
              refunds: { pool: unknown; payments: unknown };
            }>;
          }
        ).orderAdminActionsRuntime();
        expect(runtime.actions.pool).toBe(pool);
        expect(runtime.refunds.pool).toBe(pool);
        expect(runtime.refunds.payments).toBeInstanceOf(
          live ? StripePaymentService : FakePaymentService,
        );
        const dependencies = runtime.actions.dependencies;
        expect(dependencies.refunds).toBe(runtime.refunds);
        expect(dependencies.fulfillment).toBe(fulfillment);
        expect(dependencies.operations).toMatchObject({
          pool,
          storage: setup.storage,
          fulfillment,
          lifecycle: dependencies.lifecycle,
        });
        expect(dependencies.repricing.pool).toBe(pool);
        expect(dependencies.repricing.taxes).toBeInstanceOf(
          live ? StripeTaxService : FakeTaxService,
        );
        expect(dependencies.repricing.configuration.developmentProviderOnly).toBe(!live);
        expect(setup.fulfillment).toHaveBeenCalledWith(
          expect.objectContaining({
            adapter: live ? 'printify' : 'fake',
            apiToken: 'private-token',
            shopId: 'shop',
          }),
        );
      },
    );
});
