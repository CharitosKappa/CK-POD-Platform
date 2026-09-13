import { randomUUID } from 'node:crypto';

import { createDatabaseClient, integrationTestDatabaseUrl } from '@let-it-be/db';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as domain from './index';
import type { AdminStaffSession } from './admin-commerce';

class ArchiveFixtureFulfillment extends domain.FakePrintifyFulfillmentAdapter {
  override async quoteShipping(): Promise<domain.NormalizedShippingQuote> {
    return {
      method: 'Standard',
      shippingCents: 550,
      currency: 'USD',
      estimatedDeliveryMinDays: 5,
      estimatedDeliveryMaxDays: 8,
      estimateKind: 'ESTIMATE',
      expiresAt: null,
    };
  }
}

const integrationDatabaseUrl = integrationTestDatabaseUrl(process.env);
const suite = integrationDatabaseUrl ? describe : describe.skip;

suite('order archive transaction integration', () => {
  const database = createDatabaseClient(integrationDatabaseUrl!);
  const applicationName = `archive-test-${randomUUID()}`;
  const actionUrl = new URL(integrationDatabaseUrl ?? 'postgresql://localhost/test');
  actionUrl.searchParams.set('application_name', applicationName);
  const actionDatabase = createDatabaseClient(actionUrl.toString());
  const pool = database.pool;
  const staff: AdminStaffSession = {
    id: randomUUID(),
    staffMemberId: randomUUID(),
    role: 'OPERATIONS',
    email: `archive-${randomUUID()}@example.test`,
    expiresAt: new Date('2099-01-01'),
  };
  beforeAll(async () => {
    await pool.query(
      `INSERT INTO app.staff_members (id,normalized_email,role,status)
      VALUES ($1,$2,'OPERATIONS','ACTIVE')`,
      [staff.staffMemberId, staff.email],
    );
  });
  afterAll(async () => {
    await actionDatabase.close();
    await database.close();
  });
  function service() {
    expect(domain.OrderAdminActionsService).toBeTypeOf('function');
    return new domain.OrderAdminActionsService(actionDatabase.pool);
  }

  // Real commerce creates valid independent payment, item, and fulfillment records.
  async function fixture(fulfillment = 'DELIVERED', canonical = 'PAID') {
    const identity = new domain.IdentityService(pool);
    const guest = await identity.createGuestSession();
    const project = await new domain.ProjectService(pool).create(guest, {
      productModelId: 'essential-dtg-tee',
      colorCode: 'black',
    });
    const storage = new MemoryObjectStorage();
    const key = `archive-fixture/${randomUUID()}.svg`;
    const body = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><path d="M260 320h680v960H260z" fill="#f6b943"/></svg>',
    );
    const asset = (
      await pool.query<{ id: string }>(
        `INSERT INTO app.assets (project_id,asset_type,storage_key,content_type,byte_size,width,height)
       VALUES ($1,'PREPRESS_PREVIEW',$2,'image/svg+xml',$3,1200,1600) RETURNING id`,
        [project.id, key, body.byteLength],
      )
    ).rows[0]!;
    await storage.put({ key, body, contentType: 'image/svg+xml' });
    await pool.query(
      `INSERT INTO app.prepress_runs (project_id,project_version_id,production_profile_id,
      status,renderer_version,idempotency_key,preview_asset_id)
      VALUES ($1,$2,'development-essential-dtg-front-v1','PASSED','fixture',$3,$4)`,
      [project.id, project.activeVersionId, randomUUID(), asset.id],
    );
    const commerce = new domain.CommerceService(
      pool,
      new domain.FakePaymentService(),
      new domain.FakeTaxService(875),
      new ArchiveFixtureFulfillment(),
      new domain.MockupService(pool, storage),
    );
    const cart = await commerce.createCart(guest, {
      projectId: project.id,
      size: 'M',
      quantity: 2,
    });
    await commerce.approveProof(guest, cart.id);
    const addressId = await commerce.saveShippingAddress(guest, cart.id, {
      recipientName: 'Archive Fixture',
      email: `archive-order-${randomUUID()}@example.test`,
      line1: '100 Main Street',
      city: 'San Francisco',
      stateCode: 'CA',
      postalCode: '94107',
      countryCode: 'US',
    });
    const checkout = await commerce.startCheckout(guest, cart.id, {
      shippingAddressId: addressId,
      billingAddress: null,
      idempotencyKey: randomUUID(),
    });
    const paid = await commerce.simulateFakePayment(guest, checkout.id, 'SUCCEEDED');
    const orderNumber = paid.orderNumber!;
    const orderId = (
      await pool.query<{ id: string }>(
        `UPDATE app.orders SET status=$2 WHERE order_number=$1 RETURNING id`,
        [orderNumber, canonical],
      )
    ).rows[0]!.id;
    const groups = await pool.query<{ id: string }>(
      `UPDATE app.order_fulfillment_groups SET printing_status='PRINTED',fulfillment_status=$2
       WHERE order_id=$1 RETURNING id`,
      [orderId, fulfillment],
    );
    expect(groups.rows).toHaveLength(1);
    const itemId = (
      await pool.query<{ id: string }>(`SELECT id FROM app.order_items WHERE order_id=$1`, [
        orderId,
      ])
    ).rows[0]!.id;
    const input = (overrides: Record<string, unknown> = {}) => ({
      orderNumber,
      reasonCode: 'ORDER_COMPLETE',
      note: 'Reviewed by operations',
      idempotencyKey: randomUUID(),
      ...overrides,
    });
    return { orderId, orderNumber, groupId: groups.rows[0]!.id, itemId, input };
  }

  async function snapshot(orderId: string) {
    const order = (await pool.query(`SELECT * FROM app.orders WHERE id=$1`, [orderId])).rows[0];
    const groups = (
      await pool.query(`SELECT * FROM app.order_fulfillment_groups WHERE order_id=$1 ORDER BY id`, [
        orderId,
      ])
    ).rows;
    const payments = (
      await pool.query(
        `SELECT p.* FROM app.payments p JOIN app.orders o
      ON o.checkout_attempt_id=p.checkout_attempt_id WHERE o.id=$1`,
        [orderId],
      )
    ).rows;
    const refunds = (
      await pool.query(`SELECT * FROM app.order_refunds WHERE order_id=$1 ORDER BY id`, [orderId])
    ).rows;
    const returns = (
      await pool.query(`SELECT * FROM app.order_returns WHERE order_id=$1 ORDER BY id`, [orderId])
    ).rows;
    const history = (
      await pool.query(`SELECT * FROM app.order_state_history WHERE order_id=$1 ORDER BY id`, [
        orderId,
      ])
    ).rows;
    const items = (
      await pool.query(`SELECT * FROM app.order_items WHERE order_id=$1 ORDER BY id`, [orderId])
    ).rows;
    return { order, groups, payments, refunds, returns, history, items };
  }
  async function audits(orderId: string) {
    return (
      await pool.query(
        `SELECT * FROM app.order_operational_audits
      WHERE order_id=$1 AND action IN ('order_archived','order_unarchived') ORDER BY created_at,id`,
        [orderId],
      )
    ).rows;
  }

  // Incorrectly deriving archive from the canonical or Printing state rejects fulfilled groups.
  it.each(['FULFILLED', 'DELIVERED'])(
    'archives aggregate %s without changing independent records',
    async (state) => {
      const f = await fixture(state);
      await pool.query(
        `INSERT INTO app.order_refunds (order_id,payment_id,provider,idempotency_key,
      amount_cents,reason_code,status,initiated_by_staff_member_id)
      SELECT $1,p.id,p.provider,$2,100,'CUSTOMER_REQUEST','PENDING',$3 FROM app.payments p
      JOIN app.orders o ON o.checkout_attempt_id=p.checkout_attempt_id WHERE o.id=$1`,
        [f.orderId, randomUUID(), staff.staffMemberId],
      );
      await pool.query(
        `INSERT INTO app.order_returns (order_id,state,reason_code,created_by_staff_member_id,idempotency_key)
      VALUES ($1,'RECEIVED','CUSTOMER_REQUEST',$2,$3)`,
        [f.orderId, staff.staffMemberId, randomUUID()],
      );
      const before = await snapshot(f.orderId);
      const input = f.input();
      const result = await service().archive(staff, input);
      expect(result).toEqual({
        orderId: f.orderId,
        archived: true,
        archivedAt: expect.any(Date),
        duplicate: false,
      });
      expect(await snapshot(f.orderId)).toEqual({
        ...before,
        order: {
          ...before.order,
          archived_at: result.archivedAt,
          archived_by_staff_member_id: staff.staffMemberId,
        },
      });
      expect(await audits(f.orderId)).toMatchObject([
        {
          action: 'order_archived',
          actor_type: 'OPS',
          actor_user_id: null,
          actor_staff_member_id: staff.staffMemberId,
          reason_code: 'ORDER_COMPLETE',
          idempotency_key: input.idempotencyKey,
          metadata: {
            source: 'ADMIN',
            note: input.note,
            before: { archivedAt: null, archivedByStaffMemberId: null },
            after: {
              archivedAt: result.archivedAt!.toISOString(),
              archivedByStaffMemberId: staff.staffMemberId,
            },
            result: {
              orderId: f.orderId,
              archived: true,
              archivedAt: result.archivedAt!.toISOString(),
            },
          },
        },
      ]);
    },
  );

  // Canonical cancellation alone is terminal, even without any fulfillment groups.
  it('archives canonical CANCELLED and admits OWNER staff', async () => {
    const f = await fixture('UNFULFILLED', 'CANCELLED');
    await pool.query(`DELETE FROM app.order_fulfillment_groups WHERE order_id=$1`, [f.orderId]);
    await expect(service().archive({ ...staff, role: 'OWNER' }, f.input())).resolves.toMatchObject({
      archived: true,
      duplicate: false,
    });
    expect((await snapshot(f.orderId)).order).toMatchObject({
      status: 'CANCELLED',
      archived_by_staff_member_id: staff.staffMemberId,
    });
  });

  // Group cancellation cannot bypass the canonical cancellation authority.
  it.each(['UNFULFILLED', 'PARTIALLY_FULFILLED', 'CANCELLED'])(
    'rejects active %s orders and returns fresh eligibility',
    async (state) => {
      const f = await fixture(state);
      const before = await snapshot(f.orderId);
      await expect(service().archive(staff, f.input())).rejects.toMatchObject({
        eligibility: { actions: { archive: false, unarchive: false, refund: true } },
      });
      expect(await snapshot(f.orderId)).toEqual(before);
      expect(await audits(f.orderId)).toEqual([]);
    },
  );

  it('rejects a mixed fulfilled/unfulfilled order and reloads every Printing group', async () => {
    const f = await fixture('DELIVERED');
    await pool.query(
      `UPDATE app.order_fulfillment_groups SET printing_status='NOT_STARTED' WHERE id=$1`,
      [f.groupId],
    );
    await pool.query(
      `INSERT INTO app.order_fulfillment_groups (order_id,group_key,adapter_type,provider_id,
      qualification_id,shipping_snapshot,printing_status,fulfillment_status)
      SELECT order_id,'second-group',adapter_type,provider_id,qualification_id,shipping_snapshot,'IN_PRODUCTION','UNFULFILLED'
      FROM app.order_fulfillment_groups WHERE id=$1`,
      [f.groupId],
    );
    await expect(service().archive(staff, f.input())).rejects.toMatchObject({
      eligibility: {
        actions: { archive: false, cancel: false },
        editFields: { items: false, pricing: false },
      },
    });
    expect(await audits(f.orderId)).toEqual([]);
  });

  it('recomputes refunded and reserved balances and consumed return quantities from persistence', async () => {
    const f = await fixture();
    const actions = service();
    await actions.archive(staff, f.input());
    await expect(actions.archive(staff, f.input())).rejects.toMatchObject({
      eligibility: {
        actions: { refund: true, return: true },
        editFields: { shippingAddress: false },
      },
    });
    await pool.query(
      `INSERT INTO app.order_refunds (order_id,payment_id,provider,idempotency_key,
      amount_cents,reason_code,status,initiated_by_staff_member_id)
      SELECT $1,p.id,p.provider,$2,100,'CUSTOMER_REQUEST','SUCCEEDED',$4::uuid FROM app.payments p
      JOIN app.orders o ON o.checkout_attempt_id=p.checkout_attempt_id WHERE o.id=$1
      UNION ALL SELECT $1,p.id,p.provider,$3,p.amount_cents-100,'CUSTOMER_REQUEST','PENDING',$4::uuid
      FROM app.payments p JOIN app.orders o ON o.checkout_attempt_id=p.checkout_attempt_id WHERE o.id=$1`,
      [f.orderId, randomUUID(), randomUUID(), staff.staffMemberId],
    );
    await pool.query(
      `WITH returned AS (
      INSERT INTO app.order_returns (order_id,state,reason_code,created_by_staff_member_id,idempotency_key)
      VALUES ($1,'RECEIVED','CUSTOMER_REQUEST',$2,$3) RETURNING id)
      INSERT INTO app.order_return_items (order_return_id,order_item_id,quantity) SELECT id,$4,2 FROM returned`,
      [f.orderId, staff.staffMemberId, randomUUID(), f.itemId],
    );
    await expect(actions.archive(staff, f.input())).rejects.toMatchObject({
      eligibility: {
        actions: { refund: false, return: false },
      },
    });
    expect(await audits(f.orderId)).toHaveLength(1);
  });

  it('clears the archive marker and preserves history and original results on later retries', async () => {
    const f = await fixture();
    const actions = service();
    const firstInput = f.input();
    const archived = await actions.archive(staff, firstInput);
    const beforeUnarchive = await snapshot(f.orderId);
    const undoInput = f.input({ reasonCode: 'REOPENED' });
    const unarchived = await actions.unarchive(staff, undoInput);
    expect(unarchived).toEqual({
      orderId: f.orderId,
      archived: false,
      archivedAt: null,
      duplicate: false,
    });
    expect(await snapshot(f.orderId)).toEqual({
      ...beforeUnarchive,
      order: {
        ...beforeUnarchive.order,
        archived_at: null,
        archived_by_staff_member_id: null,
      },
    });
    expect(await actions.archive(staff, { ...firstInput, note: 'Changed retry payload' })).toEqual({
      ...archived,
      duplicate: true,
    });
    expect((await snapshot(f.orderId)).order).toMatchObject({ archived_at: null });
    const again = await actions.archive(staff, f.input());
    expect(await actions.unarchive(staff, undoInput)).toEqual({ ...unarchived, duplicate: true });
    expect((await snapshot(f.orderId)).order).toMatchObject({ archived_at: again.archivedAt });
    const events = await audits(f.orderId);
    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({
      action: 'order_unarchived',
      reason_code: 'REOPENED',
      metadata: {
        before: {
          archivedAt: archived.archivedAt!.toISOString(),
          archivedByStaffMemberId: staff.staffMemberId,
        },
        after: { archivedAt: null, archivedByStaffMemberId: null },
        result: { archived: false, archivedAt: null },
      },
    });
  });

  it('returns typed conflicts for stale archive/unarchive requests', async () => {
    const f = await fixture();
    const actions = service();
    await expect(actions.unarchive(staff, f.input())).rejects.toBeInstanceOf(
      domain.OrderAdminActionConflictError,
    );
    await actions.archive(staff, f.input());
    await expect(actions.archive(staff, f.input())).rejects.toMatchObject({
      eligibility: { actions: { archive: false, unarchive: true } },
    });
    expect(await audits(f.orderId)).toHaveLength(1);
  });

  it.each(['PREPRESS', 'READ_ONLY'] as const)(
    'rejects %s for both mutations without persisted effects',
    async (role) => {
      const f = await fixture();
      const actions = service();
      const before = await snapshot(f.orderId);
      await expect(actions.archive({ ...staff, role }, f.input())).rejects.toBeInstanceOf(
        domain.OrderAdminActionAccessError,
      );
      expect(await snapshot(f.orderId)).toEqual(before);
      await actions.archive(staff, f.input());
      const archived = await snapshot(f.orderId);
      await expect(actions.unarchive({ ...staff, role }, f.input())).rejects.toBeInstanceOf(
        domain.OrderAdminActionAccessError,
      );
      expect(await snapshot(f.orderId)).toEqual(archived);
      expect(await audits(f.orderId)).toHaveLength(1);
    },
  );

  it('returns typed not-found errors for both actions', async () => {
    const actions = service();
    for (const method of ['archive', 'unarchive'] as const) {
      await expect(
        actions[method](staff, {
          orderNumber: `#missing-${randomUUID()}`,
          reasonCode: 'ORDER_COMPLETE',
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toBeInstanceOf(domain.OrderAdminActionNotFoundError);
    }
  });

  // Without a lock, simultaneous retries could append two events or fail at the unique constraint.
  it('serializes concurrent duplicate keys into one result and one audit', async () => {
    const f = await fixture();
    const actions = service();
    const input = f.input();
    const results = await Promise.all([
      actions.archive(staff, input),
      actions.archive(staff, input),
    ]);
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    expect(results[0]!.archivedAt).toEqual(results[1]!.archivedAt);
    expect(await audits(f.orderId)).toHaveLength(1);
    const undo = f.input();
    const undoResults = await Promise.all([
      actions.unarchive(staff, undo),
      actions.unarchive(staff, undo),
    ]);
    expect(undoResults.map((r) => r.duplicate).sort()).toEqual([false, true]);
    expect(await audits(f.orderId)).toHaveLength(2);
  });

  it('serializes different keys against the same order and rejects the stale action', async () => {
    const f = await fixture();
    const actions = service();
    const results = await Promise.allSettled([
      actions.archive(staff, f.input()),
      actions.archive(staff, f.input()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toMatchObject([
      { reason: expect.any(domain.OrderAdminActionConflictError) },
    ]);
    expect(await audits(f.orderId)).toHaveLength(1);
  });

  it('rejects keys reused across actions or concurrent orders with a typed conflict', async () => {
    const first = await fixture();
    const second = await fixture();
    const actions = service();
    const idempotencyKey = randomUUID();
    const results = await Promise.allSettled([
      actions.archive(staff, first.input({ idempotencyKey })),
      actions.archive(staff, second.input({ idempotencyKey })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toMatchObject([
      { reason: expect.any(domain.OrderAdminActionConflictError) },
    ]);
    const winner = results[0]!.status === 'fulfilled' ? first : second;
    const loser = winner === first ? second : first;
    await expect(actions.unarchive(staff, winner.input({ idempotencyKey }))).rejects.toBeInstanceOf(
      domain.OrderAdminActionConflictError,
    );
    expect(await audits(winner.orderId)).toHaveLength(1);
    expect(await audits(loser.orderId)).toEqual([]);
    expect((await snapshot(loser.orderId)).order).toMatchObject({ archived_at: null });
  });

  async function waitForDatabaseLock() {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const waiting = await pool.query(
        `SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'`,
        [applicationName],
      );
      if (waiting.rows.length) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Archive action did not wait on the held PostgreSQL row lock.');
  }

  // The submitted action must wait, then read the latest values, not a pre-lock snapshot.
  it.each(['order', 'group'])(
    'waits for the %s row lock and rejects freshly unfulfilled data',
    async (locked) => {
      const f = await fixture();
      const actions = service();
      const holder = await pool.connect();
      let operation: Promise<unknown> | undefined;
      try {
        await holder.query('BEGIN');
        await holder.query(
          locked === 'order'
            ? `SELECT id FROM app.orders WHERE id=$1 FOR UPDATE`
            : `SELECT id FROM app.order_fulfillment_groups WHERE order_id=$1 FOR UPDATE`,
          [f.orderId],
        );
        // Settle immediately so a locking regression cannot leak an unhandled rejection.
        operation = actions.archive(staff, f.input()).then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        );
        await waitForDatabaseLock();
        await holder.query(
          `UPDATE app.order_fulfillment_groups SET fulfillment_status='UNFULFILLED' WHERE order_id=$1`,
          [f.orderId],
        );
        await holder.query('COMMIT');
        expect(await operation).toMatchObject({
          error: expect.any(domain.OrderAdminActionConflictError),
        });
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
        await operation?.catch(() => undefined);
      }
      expect((await snapshot(f.orderId)).order).toMatchObject({ archived_at: null });
      expect(await audits(f.orderId)).toEqual([]);
    },
  );

  // Audit persistence is part of the same transaction as both archive marker updates.
  it.each(['archive', 'unarchive'] as const)(
    'rolls back %s if its audit cannot persist, then permits retry',
    async (method) => {
      const f = await fixture();
      const actions = service();
      if (method === 'unarchive') await actions.archive(staff, f.input());
      const before = await snapshot(f.orderId);
      const priorAudits = await audits(f.orderId);
      const name = `archive_test_${randomUUID().replaceAll('-', '')}`;
      const input = f.input();
      await pool.query(`CREATE FUNCTION app.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.order_id='${f.orderId}'::uuid THEN RAISE EXCEPTION 'fixture archive audit failure'; END IF; RETURN NEW; END; $$`);
      try {
        await pool.query(
          `CREATE TRIGGER ${name} BEFORE INSERT ON app.order_operational_audits FOR EACH ROW EXECUTE FUNCTION app.${name}()`,
        );
        await expect(actions[method](staff, input)).rejects.toThrow(
          'fixture archive audit failure',
        );
        expect(await snapshot(f.orderId)).toEqual(before);
        expect(await audits(f.orderId)).toEqual(priorAudits);
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${name} ON app.order_operational_audits`);
        await pool.query(`DROP FUNCTION app.${name}()`);
      }
      await expect(actions[method](staff, input)).resolves.toMatchObject({
        archived: method === 'archive',
        duplicate: false,
      });
      expect(await audits(f.orderId)).toHaveLength(priorAudits.length + 1);
    },
  );
});
