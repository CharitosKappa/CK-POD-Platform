import { randomUUID } from 'node:crypto';

import { createDatabaseClient } from '@let-it-be/db';
import { afterAll, describe, expect, it } from 'vitest';

import { reconcileCustomerProfiles } from './customer-operations';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite('customer profile reconciliation integration', () => {
  const database = createDatabaseClient(process.env.DATABASE_URL!);
  const userId = randomUUID();
  const email = `reconcile-${randomUUID()}@example.test`;

  afterAll(async () => {
    await database.pool.query(`DELETE FROM app.customer_profiles WHERE normalized_email=$1`, [
      email,
    ]);
    await database.pool.query(`DELETE FROM app.users WHERE id=$1`, [userId]);
    await database.close();
  });

  it('does not change updated_at when the source data is unchanged', async () => {
    await database.pool.query(
      `INSERT INTO app.users (id,email,password_hash,email_verified_at,created_at,updated_at)
       VALUES ($1,$2,'test-only',now(),'2026-01-02T00:00:00Z','2026-01-02T00:00:00Z')`,
      [userId, email],
    );
    await reconcileCustomerProfiles(database.pool);
    const stableTimestamp = new Date('2020-01-01T00:00:00Z');
    await database.pool.query(
      `UPDATE app.customer_profiles SET updated_at=$2 WHERE normalized_email=$1`,
      [email, stableTimestamp],
    );

    await reconcileCustomerProfiles(database.pool);
    await reconcileCustomerProfiles(database.pool);

    const result = await database.pool.query<{ updated_at: Date }>(
      `SELECT updated_at FROM app.customer_profiles WHERE normalized_email=$1`,
      [email],
    );
    expect(result.rows[0]?.updated_at).toEqual(stableTimestamp);
  });
});
