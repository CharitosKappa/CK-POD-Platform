import { z } from 'zod';

const nodeEnvironment = z.enum(['development', 'test', 'production']);
const adapterDriver = z.enum(['memory', 's3']);
const queueDriver = z.enum(['memory', 'redis']);

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
