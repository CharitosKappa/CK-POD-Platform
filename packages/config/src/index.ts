import { z } from 'zod';

const nodeEnvironment = z.enum(['development', 'test', 'production']);
const adapterDriver = z.enum(['memory', 's3']);
const queueDriver = z.enum(['memory', 'redis']);
const fulfillmentAdapterMode = z.enum(['fake', 'printify']);
const paymentAdapterMode = z.enum(['fake', 'stripe']);
const taxAdapterMode = z.enum(['fake', 'stripe']);
const lifecycleAdapterMode = z.enum(['fake', 'klaviyo']);
const positiveInteger = z.coerce.number().int().min(0);
const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const defaultProviderConfiguration = JSON.stringify([
  {
    id: 'development-primary',
    adapter: 'deterministic-svg',
    enabled: true,
    tasks: ['TEXT_TO_ARTWORK', 'SELECTED_ELEMENT_EDITING'],
    model: 'development-svg-v1',
    priority: 10,
    estimatedCostCents: 0,
    timeoutMs: 5000,
    maxRetries: 0,
    fallbackEligible: true,
  },
  {
    id: 'development-fallback',
    adapter: 'deterministic-pattern',
    enabled: true,
    tasks: ['TEXT_TO_ARTWORK', 'SELECTED_ELEMENT_EDITING'],
    model: 'development-pattern-v1',
    priority: 20,
    estimatedCostCents: 0,
    timeoutMs: 5000,
    maxRetries: 0,
    fallbackEligible: true,
  },
]);

export const serverEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvironment.default('development'),
    APP_ENV: z.string().min(1).default('local'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    NEXT_PUBLIC_APP_URL: z.string().url(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    STORAGE_DRIVER: adapterDriver.default('memory'),
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    QUEUE_DRIVER: queueDriver.default('memory'),
    AI_PROVIDER_CONFIG: z.string().min(2).default(defaultProviderConfiguration),
    AI_GUEST_FREE_CREDITS: positiveInteger.default(1),
    AI_REGISTERED_FREE_CREDITS: positiveInteger.default(0),
    AI_MAX_REFERENCE_ASSETS: z.coerce.number().int().min(0).max(5).default(5),
    EDITOR_UNDO_LIMIT: z.coerce.number().int().min(1).max(100).default(50),
    EDITOR_AUTOSAVE_DEBOUNCE_MS: z.coerce.number().int().min(250).max(5000).default(700),
    PREPRESS_FONT_ROOT: optionalNonEmptyString,
    FULFILLMENT_ADAPTER: fulfillmentAdapterMode.default('fake'),
    PRINTIFY_API_TOKEN: optionalNonEmptyString,
    PRINTIFY_SHOP_ID: optionalNonEmptyString,
    PRINTIFY_API_BASE_URL: z.string().url().default('https://api.printify.com/v1'),
    PRINTIFY_WEBHOOK_SECRET: optionalNonEmptyString,
    PRINTIFY_PRODUCTION_SUBMISSION_ENABLED: z.coerce.boolean().default(false),
    PAYMENT_ADAPTER: paymentAdapterMode.default('fake'),
    STRIPE_SECRET_KEY: optionalNonEmptyString,
    STRIPE_PUBLISHABLE_KEY: optionalNonEmptyString,
    STRIPE_WEBHOOK_SECRET: optionalNonEmptyString,
    STRIPE_API_BASE_URL: z.string().url().default('https://api.stripe.com/v1'),
    DEVELOPMENT_TAX_RATE_BASIS_POINTS: z.coerce.number().int().min(0).max(10_000).default(0),
    TAX_ADAPTER: taxAdapterMode.default('fake'),
    LIFECYCLE_ADAPTER: lifecycleAdapterMode.default('fake'),
    KLAVIYO_API_KEY: optionalNonEmptyString,
    KLAVIYO_API_BASE_URL: z.string().url().default('https://a.klaviyo.com/api'),
    LIFECYCLE_GENERATED_NO_PURCHASE_DELAY_MS: positiveInteger.default(86_400_000),
    LIFECYCLE_CART_ABANDONMENT_DELAY_MS: positiveInteger.default(3_600_000),
    LIFECYCLE_CHECKOUT_ABANDONMENT_DELAY_MS: positiveInteger.default(1_800_000),
    LIFECYCLE_REORDER_REVISIT_DELAY_MS: positiveInteger.default(2_592_000_000),
    LIFECYCLE_PROCESS_INTERVAL_MS: positiveInteger.default(60_000),
  })
  .superRefine((environment, context) => {
    if (environment.PAYMENT_ADAPTER === 'stripe') {
      for (const key of [
        'STRIPE_SECRET_KEY',
        'STRIPE_PUBLISHABLE_KEY',
        'STRIPE_WEBHOOK_SECRET',
      ] as const) {
        if (!environment[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required when PAYMENT_ADAPTER=stripe.`,
            path: [key],
          });
        }
      }
    }
    if (environment.TAX_ADAPTER === 'stripe' && !environment.STRIPE_SECRET_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'STRIPE_SECRET_KEY is required when TAX_ADAPTER=stripe.',
        path: ['STRIPE_SECRET_KEY'],
      });
    }
    if (environment.LIFECYCLE_ADAPTER === 'klaviyo' && !environment.KLAVIYO_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'KLAVIYO_API_KEY is required when LIFECYCLE_ADAPTER=klaviyo.',
        path: ['KLAVIYO_API_KEY'],
      });
    }
    if (environment.STORAGE_DRIVER !== 's3') {
      if (environment.FULFILLMENT_ADAPTER === 'printify') {
        for (const key of ['PRINTIFY_API_TOKEN', 'PRINTIFY_SHOP_ID'] as const) {
          if (!environment[key]) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${key} is required when FULFILLMENT_ADAPTER=printify.`,
              path: [key],
            });
          }
        }
      }
      return;
    }

    for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!environment[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} is required when STORAGE_DRIVER=s3.`,
          path: [key],
        });
      }
    }
    if (environment.FULFILLMENT_ADAPTER === 'printify') {
      for (const key of ['PRINTIFY_API_TOKEN', 'PRINTIFY_SHOP_ID'] as const) {
        if (!environment[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required when FULFILLMENT_ADAPTER=printify.`,
            path: [key],
          });
        }
      }
    }
  });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(
  input: Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(input);
}

export const defaultAiProviderConfiguration = defaultProviderConfiguration;
