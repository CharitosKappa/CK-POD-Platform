import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export interface SqlResult<T> {
  rows: T[];
  rowCount: number | null;
}

export interface SqlClient {
  query<T>(text: string, values?: readonly unknown[]): Promise<SqlResult<T>>;
}

export interface TransactionClient extends SqlClient {
  release(): void;
}

export interface SqlPool extends SqlClient {
  connect(): Promise<TransactionClient>;
}

export async function withTransaction<T>(
  pool: SqlPool,
  operation: (client: SqlClient) => Promise<T>,
) {
  const client = await pool.connect();
  await client.query('BEGIN');

  try {
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Creates a short-lived, typed database boundary. Runtime modules own the
 * lifecycle and must call `close` during graceful shutdown.
 */
export function createDatabaseClient(connectionString: string) {
  const pool = new Pool({ connectionString });

  return {
    db: drizzle({ client: pool }),
    pool,
    close: () => pool.end(),
  };
}
