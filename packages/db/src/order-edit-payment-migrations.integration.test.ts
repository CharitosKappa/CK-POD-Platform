import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { createDatabaseClient } from './index';
import { integrationTestDatabaseUrl } from './integration-test-database';

const databaseUrl = integrationTestDatabaseUrl(process.env);
const suite = databaseUrl ? describe : describe.skip;
const database = createDatabaseClient(databaseUrl!);
const migrationsDirectory = fileURLToPath(new URL('../drizzle/', import.meta.url));

function schemaName() {
  return `payment_repair_${randomUUID().replaceAll('-', '')}`;
}

function inSchema(sql: string, schema: string) {
  return sql.replaceAll('app.', `"${schema}".`);
}

async function migration(name: string, schema: string) {
  const sql = await readFile(`${migrationsDirectory}/${name}.sql`, 'utf8');
  await database.pool.query(inSchema(sql, schema));
}

async function dropSchema(schema: string) {
  await database.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

suite('order edit payment migration repair', () => {
  afterAll(() => database.close());

  it('fresh 0051 preserves failed attempts, marks migrated prepares read-only, and backfills captures', async () => {
    const schema = schemaName();
    const orderId = randomUUID();
    try {
      await database.pool.query(`CREATE SCHEMA "${schema}";
        CREATE TABLE "${schema}".orders (
          id uuid PRIMARY KEY,customer_email text NOT NULL,billing_address_snapshot jsonb NOT NULL,
          shipping_address_snapshot jsonb NOT NULL
        );
        CREATE TABLE "${schema}".order_edit_payment_attempts (
          id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES "${schema}".orders(id),
          order_revision_id uuid NOT NULL,status text NOT NULL,amount_cents integer NOT NULL,
          currency text NOT NULL,provider text,provider_payment_id text,provider_client_secret text,
          provider_status text,initiated_by_staff_member_id uuid NOT NULL,idempotency_key text NOT NULL UNIQUE,
          failure_code text,created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
          UNIQUE(provider,provider_payment_id)
        );
        CREATE UNIQUE INDEX order_edit_payment_attempts_one_active_idx
          ON "${schema}".order_edit_payment_attempts(order_id)
          WHERE status IN ('PREPARING','PENDING');
        CREATE TABLE "${schema}".payments (
          id uuid PRIMARY KEY,provider text NOT NULL,provider_payment_id text NOT NULL,currency text NOT NULL
        );
        CREATE TABLE "${schema}".order_refunds (
          id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES "${schema}".orders(id),
          payment_id uuid REFERENCES "${schema}".payments(id),provider text,provider_refund_id text,
          idempotency_key text NOT NULL UNIQUE,amount_cents integer NOT NULL,reason_code text NOT NULL,
          status text NOT NULL CONSTRAINT order_refunds_status_check
            CHECK(status IN ('PENDING','SUCCEEDED','FAILED')),
          notes text,initiated_by_user_id uuid,initiated_by_staff_member_id uuid,
          destination text NOT NULL DEFAULT 'ORIGINAL_PAYMENT',created_at timestamptz NOT NULL DEFAULT now(),
          completed_at timestamptz
        );
        INSERT INTO "${schema}".orders VALUES (
          '${orderId}','migration@example.test','{}','{"recipientName":"Migration"}'
        );`);
      const attempts = {
        preparing: randomUUID(),
        succeeded: randomUUID(),
        failedUnbacked: randomUUID(),
        failedBackedOne: randomUUID(),
        failedBackedTwo: randomUUID(),
      };
      for (const [name, id] of Object.entries(attempts)) {
        const status =
          name === 'preparing' ? 'PREPARING' : name === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
        const backed = name !== 'preparing' && name !== 'failedUnbacked';
        await database.pool.query(
          `INSERT INTO "${schema}".order_edit_payment_attempts
           (id,order_id,order_revision_id,status,amount_cents,currency,provider,provider_payment_id,
            initiated_by_staff_member_id,idempotency_key,completed_at)
           VALUES ($1,$2,$3,$4,500,'USD',$5,$6,$7,$8,$9)`,
          [
            id,
            orderId,
            randomUUID(),
            status,
            backed ? 'FAKE' : null,
            backed ? `pi_${id}` : null,
            randomUUID(),
            `migration-${id}`,
            status === 'PREPARING' ? null : new Date(),
          ],
        );
      }

      await migration('0051_order_edit_payment_hardening', schema);
      await migration('0052_order_edit_payment_repair', schema);
      await migration('0052_order_edit_payment_repair', schema);

      expect(
        (
          await database.pool.query(
            `SELECT status,count(*)::int count FROM "${schema}".order_edit_payment_attempts
             WHERE id=ANY($1::uuid[]) GROUP BY status ORDER BY status`,
            [Object.values(attempts)],
          )
        ).rows,
      ).toEqual([
        { status: 'FAILED', count: 3 },
        { status: 'PREPARING', count: 1 },
        { status: 'SUCCEEDED', count: 1 },
      ]);
      expect(
        (
          await database.pool.query(
            `SELECT provider_submission_started_at IS NOT NULL AS started
             FROM "${schema}".order_edit_payment_attempts WHERE id=$1`,
            [attempts.preparing],
          )
        ).rows,
      ).toEqual([{ started: true }]);
      expect(
        (
          await database.pool.query(
            `SELECT order_edit_payment_attempt_id,amount_cents FROM "${schema}".order_payment_captures`,
          )
        ).rows,
      ).toEqual([{ order_edit_payment_attempt_id: attempts.succeeded, amount_cents: 500 }]);
    } finally {
      await dropSchema(schema);
    }
  });

  it('0052 idempotently repairs the original 0051 shape and classifies unresolved allocations conservatively', async () => {
    const schema = schemaName();
    const orderId = randomUUID();
    const preparingId = randomUUID();
    const succeededId = randomUUID();
    const legacyRefundId = randomUUID();
    const pendingRefundId = randomUUID();
    const parentKey = `legacy-${randomUUID()}`;
    try {
      await database.pool.query(`CREATE SCHEMA "${schema}";
        CREATE TABLE "${schema}".orders (id uuid PRIMARY KEY);
        CREATE TABLE "${schema}".order_edit_payment_attempts (
          id uuid PRIMARY KEY,order_id uuid NOT NULL,order_revision_id uuid NOT NULL,status text NOT NULL,
          amount_cents integer NOT NULL,currency text NOT NULL,provider text,provider_payment_id text,
          request_snapshot jsonb NOT NULL,provider_submission_started_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
          completed_at timestamptz
        );
        CREATE UNIQUE INDEX order_edit_payment_attempts_one_active_idx
          ON "${schema}".order_edit_payment_attempts(order_id)
          WHERE status IN ('PREPARING','PENDING') OR (status='FAILED' AND provider_payment_id IS NOT NULL);
        CREATE TABLE "${schema}".order_payment_captures (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL,
          order_edit_payment_attempt_id uuid NOT NULL UNIQUE,provider text NOT NULL,
          provider_payment_id text NOT NULL,amount_cents integer NOT NULL,currency text NOT NULL,
          request_snapshot jsonb NOT NULL,captured_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(provider,provider_payment_id)
        );
        CREATE TABLE "${schema}".order_refunds (
          id uuid PRIMARY KEY,order_id uuid NOT NULL,idempotency_key text NOT NULL UNIQUE,
          status text NOT NULL CONSTRAINT order_refunds_status_check
            CHECK(status IN ('PENDING','SUCCEEDED','FAILED'))
        );
        CREATE TABLE "${schema}".order_refund_allocations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_refund_id uuid NOT NULL,order_id uuid NOT NULL,
          checkout_payment_id uuid,order_payment_capture_id uuid,provider text NOT NULL,
          provider_payment_id text NOT NULL,amount_cents integer NOT NULL,currency text NOT NULL,
          status text NOT NULL,provider_refund_id text,idempotency_key text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz
        );
        INSERT INTO "${schema}".orders VALUES ('${orderId}');
        INSERT INTO "${schema}".order_edit_payment_attempts
          (id,order_id,order_revision_id,status,amount_cents,currency,provider,provider_payment_id,request_snapshot,completed_at)
        VALUES
          ('${preparingId}','${orderId}','${randomUUID()}','PREPARING',500,'USD',NULL,NULL,'{}',NULL),
          ('${succeededId}','${orderId}','${randomUUID()}','SUCCEEDED',700,'USD','FAKE','pi_succeeded','{}',now());
        INSERT INTO "${schema}".order_refunds VALUES
          ('${legacyRefundId}','${orderId}','${parentKey}','SUCCEEDED'),
          ('${pendingRefundId}','${orderId}','pending-${randomUUID()}','PENDING');
        INSERT INTO "${schema}".order_refund_allocations
          (order_refund_id,order_id,checkout_payment_id,provider,provider_payment_id,amount_cents,currency,status,
           provider_refund_id,idempotency_key,created_at)
        VALUES
          ('${legacyRefundId}','${orderId}','${randomUUID()}','FAKE','pi_checkout',300,'USD','SUCCEEDED','re_legacy','${parentKey}:capture:1',now()-interval '3 minutes'),
          ('${pendingRefundId}','${orderId}','${randomUUID()}','FAKE','pi_first',200,'USD','PENDING',NULL,'multi-first-${randomUUID()}',now()-interval '2 minutes'),
          ('${pendingRefundId}','${orderId}','${randomUUID()}','FAKE','pi_second',200,'USD','PENDING',NULL,'multi-second-${randomUUID()}',now()-interval '1 minute');`);

      await migration('0052_order_edit_payment_repair', schema);
      await migration('0052_order_edit_payment_repair', schema);

      expect(
        (
          await database.pool.query(
            `SELECT provider_submission_started_at IS NOT NULL AS started
             FROM "${schema}".order_edit_payment_attempts WHERE id=$1`,
            [preparingId],
          )
        ).rows,
      ).toEqual([{ started: true }]);
      expect(
        (
          await database.pool.query(
            `SELECT order_edit_payment_attempt_id,amount_cents
             FROM "${schema}".order_payment_captures`,
          )
        ).rows,
      ).toEqual([{ order_edit_payment_attempt_id: succeededId, amount_cents: 700 }]);
      expect(
        (
          await database.pool.query(
            `SELECT idempotency_key,submission_state,allocation_sequence
             FROM "${schema}".order_refund_allocations WHERE order_refund_id=$1`,
            [legacyRefundId],
          )
        ).rows,
      ).toEqual([
        { idempotency_key: parentKey, submission_state: 'IDENTIFIED', allocation_sequence: 1 },
      ]);
      expect(
        (
          await database.pool.query(
            `SELECT submission_state,allocation_sequence FROM "${schema}".order_refund_allocations
             WHERE order_refund_id=$1 ORDER BY allocation_sequence`,
            [pendingRefundId],
          )
        ).rows,
      ).toEqual([
        { submission_state: 'SUBMISSION_STARTED', allocation_sequence: 1 },
        { submission_state: 'UNSUBMITTED', allocation_sequence: 2 },
      ]);
      await expect(
        database.pool.query(`UPDATE "${schema}".order_refunds SET status='PARTIAL' WHERE id=$1`, [
          pendingRefundId,
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await dropSchema(schema);
    }
  });
});
