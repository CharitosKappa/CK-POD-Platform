import { Pool } from 'pg';

import { requiredApplicationTables } from './required-tables.js';
import { requireDatabaseUrl } from './runtime-environment.js';

const pool = new Pool({ connectionString: requireDatabaseUrl() });

try {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'app'
       AND table_name = ANY($1::text[])`,
    [[...requiredApplicationTables]],
  );
  const presentTables = new Set(result.rows.map(({ table_name }) => table_name));
  const missingTables = requiredApplicationTables.filter(
    (tableName) => !presentTables.has(tableName),
  );

  if (missingTables.length > 0) {
    throw new Error(
      `Required application tables are missing after migrations: ${missingTables.join(', ')}.`,
    );
  }

  console.info(
    `Database migration verification passed (${requiredApplicationTables.length} required tables).`,
  );
} finally {
  await pool.end();
}
