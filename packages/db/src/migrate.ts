import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { requireDatabaseUrl } from './runtime-environment.js';

const pool = new Pool({ connectionString: requireDatabaseUrl() });

try {
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  console.info('Database migrations applied successfully.');
} finally {
  await pool.end();
}
