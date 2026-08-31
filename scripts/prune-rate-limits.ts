import { createDatabaseClient, pruneRateLimitBuckets } from '@let-it-be/db';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');

const database = createDatabaseClient(connectionString);
void pruneRateLimitBuckets(database.pool, 24 * 60 * 60_000)
  .then((removed) => console.info(`Pruned ${removed} expired API rate-limit buckets.`))
  .finally(async () => database.close());
