import { z } from 'zod';

const nodeEnvironment = z.enum(['development', 'test', 'production']);
const adapterDriver = z.enum(['memory', 's3']);
const queueDriver = z.enum(['memory', 'redis']);
const positiveInteger = z.coerce.number().int().min(0);

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
  })
  .superRefine((environment, context) => {
    if (environment.STORAGE_DRIVER !== 's3') {
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
  });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(
  input: Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(input);
}

export const defaultAiProviderConfiguration = defaultProviderConfiguration;
