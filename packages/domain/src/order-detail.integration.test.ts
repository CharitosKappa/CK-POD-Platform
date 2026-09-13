import { createDatabaseClient, integrationTestDatabaseUrl } from '@let-it-be/db';
import { afterAll, describe, expect, it } from 'vitest';

const integrationDatabaseUrl = integrationTestDatabaseUrl(process.env);
const suite = integrationDatabaseUrl ? describe : describe.skip;

suite('order detail persistence integration', () => {
  const database = createDatabaseClient(integrationDatabaseUrl!);

  afterAll(async () => {
    await database.close();
  });

  it('persists separate constrained printing and fulfillment states', async () => {
    const columns = await database.pool.query<{
      column_name: string;
      is_nullable: string;
    }>(
      `SELECT column_name,is_nullable
       FROM information_schema.columns
       WHERE table_schema='app'
         AND table_name='order_fulfillment_groups'
         AND column_name IN ('printing_status','fulfillment_status','last_provider_sync_at','production_economics_snapshot')
       ORDER BY column_name`,
    );

    expect(columns.rows).toEqual([
      { column_name: 'fulfillment_status', is_nullable: 'NO' },
      { column_name: 'last_provider_sync_at', is_nullable: 'YES' },
      { column_name: 'printing_status', is_nullable: 'NO' },
      { column_name: 'production_economics_snapshot', is_nullable: 'NO' },
    ]);
  });

  it('creates the order notes, tags, and independent history tables', async () => {
    const tables = await database.pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema='app'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [
        [
          'order_fulfillment_status_history',
          'order_notes',
          'order_printing_status_events',
          'order_tag_assignments',
          'order_tags',
        ],
      ],
    );

    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'order_fulfillment_status_history',
      'order_notes',
      'order_printing_status_events',
      'order_tag_assignments',
      'order_tags',
    ]);
  });
});
