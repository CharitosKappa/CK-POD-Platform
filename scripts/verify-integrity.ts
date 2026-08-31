import { Pool } from 'pg';

import { verifyDatabaseIntegrity } from '@let-it-be/db/integrity';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');

const pool = new Pool({ connectionString });
async function main(): Promise<void> {
  await verifyDatabaseIntegrity(pool);
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Integrity verification failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
