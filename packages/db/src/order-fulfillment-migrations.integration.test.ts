import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { createDatabaseClient } from './index';
import { integrationTestDatabaseUrl } from './integration-test-database';

const databaseUrl = integrationTestDatabaseUrl(process.env);
const suite = databaseUrl ? describe : describe.skip;
const database = createDatabaseClient(databaseUrl!);
const migrationsDirectory = fileURLToPath(new URL('../drizzle/', import.meta.url));

function schemaName() {
  return `fulfillment_repair_${randomUUID().replaceAll('-', '')}`;
}

async function migration(name: string, schema: string) {
  const sql = await readFile(`${migrationsDirectory}/${name}.sql`, 'utf8');
  await database.pool.query(sql.replaceAll('app.', `"${schema}".`));
}

async function createLegacyTables(schema: string) {
  await database.pool.query(`CREATE SCHEMA "${schema}";
    CREATE TABLE "${schema}".orders (id uuid PRIMARY KEY);
    CREATE TABLE "${schema}".staff_members (id uuid PRIMARY KEY);
    CREATE TABLE "${schema}".order_fulfillment_groups (
      id uuid PRIMARY KEY,
      order_id uuid NOT NULL REFERENCES "${schema}".orders(id),
      status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schema}".order_shipments (
      id uuid PRIMARY KEY,
      fulfillment_group_id uuid NOT NULL REFERENCES "${schema}".order_fulfillment_groups(id),
      status text NOT NULL,
      shipped_at timestamptz,
      delivered_at timestamptz
    );`);
}

async function dropSchema(schema: string) {
  await database.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

suite('order fulfillment evidence migration', () => {
  afterAll(() => database.close());

  it('never backfills Delivered from the legacy group status alone', async () => {
    const schema = schemaName();
    const orderId = randomUUID();
    const unsupported = randomUUID();
    const delivered = randomUUID();
    const shipped = randomUUID();
    try {
      await createLegacyTables(schema);
      await database.pool.query(`INSERT INTO "${schema}".orders VALUES ($1)`, [orderId]);
      await database.pool.query(
        `INSERT INTO "${schema}".order_fulfillment_groups (id,order_id,status) VALUES
           ($2,$1,'DELIVERED'),($3,$1,'DELIVERED'),($4,$1,'DELIVERED')`,
        [orderId, unsupported, delivered, shipped],
      );
      await database.pool.query(
        `INSERT INTO "${schema}".order_shipments
           (id,fulfillment_group_id,status,shipped_at,delivered_at) VALUES
           ($1,$2,'delivered',now()-interval '2 days',now()-interval '1 day'),
           ($3,$4,'shipped',now()-interval '1 day',NULL)`,
        [randomUUID(), delivered, randomUUID(), shipped],
      );

      await migration('0046_order_detail_layers', schema);

      expect(
        (
          await database.pool.query(
            `SELECT id,fulfillment_status FROM "${schema}".order_fulfillment_groups
             ORDER BY id`,
          )
        ).rows,
      ).toEqual(
        [
          { id: unsupported, fulfillment_status: 'FULFILLED' },
          { id: delivered, fulfillment_status: 'DELIVERED' },
          { id: shipped, fulfillment_status: 'FULFILLED' },
        ].sort((left, right) => left.id.localeCompare(right.id)),
      );
    } finally {
      await dropSchema(schema);
    }
  });

  it('idempotently repairs unsupported Delivered projections already created by 0046', async () => {
    const schema = schemaName();
    const orderId = randomUUID();
    const unsupported = randomUUID();
    const evidenced = randomUUID();
    try {
      await createLegacyTables(schema);
      await database.pool.query(`ALTER TABLE "${schema}".order_fulfillment_groups
           ADD COLUMN fulfillment_status text NOT NULL DEFAULT 'UNFULFILLED';
         CREATE TABLE "${schema}".order_fulfillment_status_history (
           id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
           order_id uuid NOT NULL REFERENCES "${schema}".orders(id),
           fulfillment_group_id uuid NOT NULL REFERENCES "${schema}".order_fulfillment_groups(id),
           from_state text,
           to_state text NOT NULL,
           source text NOT NULL,
           shipment_id uuid REFERENCES "${schema}".order_shipments(id),
           actor_staff_member_id uuid REFERENCES "${schema}".staff_members(id),
           metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
           created_at timestamptz NOT NULL DEFAULT now()
         );`);
      await database.pool.query(`INSERT INTO "${schema}".orders VALUES ($1)`, [orderId]);
      await database.pool.query(
        `INSERT INTO "${schema}".order_fulfillment_groups
           (id,order_id,status,fulfillment_status) VALUES
           ($2,$1,'DELIVERED','DELIVERED'),($3,$1,'DELIVERED','DELIVERED')`,
        [orderId, unsupported, evidenced],
      );
      await database.pool.query(
        `INSERT INTO "${schema}".order_shipments
           (id,fulfillment_group_id,status,shipped_at,delivered_at)
           VALUES ($1,$2,'delivered',now()-interval '2 days',now()-interval '1 day')`,
        [randomUUID(), evidenced],
      );

      await migration('0053_fulfillment_evidence_repair', schema);
      await migration('0053_fulfillment_evidence_repair', schema);

      expect(
        (
          await database.pool.query(
            `SELECT id,fulfillment_status FROM "${schema}".order_fulfillment_groups
             ORDER BY id`,
          )
        ).rows,
      ).toEqual(
        [
          { id: unsupported, fulfillment_status: 'FULFILLED' },
          { id: evidenced, fulfillment_status: 'DELIVERED' },
        ].sort((left, right) => left.id.localeCompare(right.id)),
      );
      expect(
        (
          await database.pool.query(
            `SELECT from_state,to_state,source,metadata->>'reason' AS reason
             FROM "${schema}".order_fulfillment_status_history`,
          )
        ).rows,
      ).toEqual([
        {
          from_state: 'DELIVERED',
          to_state: 'FULFILLED',
          source: 'MIGRATION',
          reason: 'delivery-evidence-missing',
        },
      ]);
    } finally {
      await dropSchema(schema);
    }
  });
});
