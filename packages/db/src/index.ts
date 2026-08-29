import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/**
 * Creates a short-lived, typed database boundary. Runtime modules own the
 * lifecycle and must call `close` during graceful shutdown.
 */
export function createDatabaseClient(connectionString: string) {
  const pool = new Pool({ connectionString });

  return {
    db: drizzle({ client: pool }),
    close: () => pool.end(),
  };
}
