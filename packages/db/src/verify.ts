import { Pool } from 'pg';

import { requireDatabaseUrl } from './runtime-environment.js';

const pool = new Pool({ connectionString: requireDatabaseUrl() });

try {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.schemata
      WHERE schema_name = 'app'
    ) AS exists`,
  );

  if (!result.rows[0]?.exists) {
    throw new Error('The app schema was not created by the Foundation migration.');
  }

  console.info('Database migration verification passed.');
} finally {
  await pool.end();
}
