import { Pool } from 'pg';

import { requireDatabaseUrl } from './runtime-environment.js';

const pool = new Pool({ connectionString: requireDatabaseUrl() });

try {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'app'
       AND table_name = ANY($1::text[])`,
    [['sessions', 'users', 'projects', 'project_versions', 'product_models', 'product_variants']],
  );

  if (result.rows.length !== 6) {
    throw new Error('Required application tables are missing after migrations.');
  }

  console.info('Database migration verification passed.');
} finally {
  await pool.end();
}
