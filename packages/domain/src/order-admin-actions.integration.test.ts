import { randomUUID } from 'node:crypto';

import { createDatabaseClient, integrationTestDatabaseUrl, type SqlPool } from '@let-it-be/db';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
  async function fixture(fulfillment = 'DELIVERED', canonical = 'PAID', printing = 'PRINTED') {
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
      `UPDATE app.order_fulfillment_groups SET printing_status=$3,fulfillment_status=$2
       WHERE order_id=$1 RETURNING id`,
      [orderId, fulfillment, printing],
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

  function cancellationService(
    cancelOrder = vi
      .fn<domain.FulfillmentService['cancelOrder']>()
      .mockResolvedValue({ state: 'CANCELLED', occurredAt: new Date('2026-09-01') }),
    options: {
      payments?: domain.PaymentService;
      lifecycle?: domain.LifecycleOrchestrator;
      pool?: SqlPool;
      fulfillment?: domain.FulfillmentService;
    } = {},
  ) {
    const servicePool = options.pool ?? actionDatabase.pool;
    const fulfillment = options.fulfillment ?? new ArchiveFixtureFulfillment();
    if (!options.fulfillment) fulfillment.cancelOrder = cancelOrder;
    const payments = options.payments ?? new domain.FakePaymentService();
    const operations = new domain.OrderOperationsService(
      servicePool,
      new MemoryObjectStorage(),
      fulfillment,
      { fulfillmentAdapter: 'fake', realProductionSubmissionEnabled: false },
    );
    const refunds = new domain.OrderRefundService(servicePool, payments);
    const actions = new domain.OrderAdminActionsService(servicePool, {
      fulfillment,
      operations,
      refunds,
      lifecycle: options.lifecycle ?? new domain.LifecycleOrchestrator(servicePool),
    });
    return { actions, cancelOrder, operations, payments, refunds };
  }
  function cancellationInput(orderNumber: string) {
    return {
      orderNumber,
      refundDestination: 'LATER' as const,
      refundAmountCents: 0,
      reasonCode: 'CUSTOMER_CANCELLATION_REQUEST',
      staffNote: 'Customer requested cancellation',
      notifyCustomer: false,
      idempotencyKey: randomUUID(),
    };
  }
  async function cancellationRows(orderId: string) {
    return {
      cancellations: (
        await pool.query(
          `SELECT * FROM app.order_cancellations WHERE order_id=$1 ORDER BY created_at,id`,
          [orderId],
        )
      ).rows,
      attempts: (
        await pool.query(
          `SELECT g.* FROM app.order_cancellation_groups g JOIN app.order_cancellations c
        ON c.id=g.order_cancellation_id WHERE c.order_id=$1 ORDER BY g.fulfillment_group_id`,
          [orderId],
        )
      ).rows,
    };
  }
  async function externalGroup(f: Awaited<ReturnType<typeof fixture>>, externalOrderId: string) {
    await pool.query(`UPDATE app.order_fulfillment_groups SET external_order_id=$2 WHERE id=$1`, [
      f.groupId,
      externalOrderId,
    ]);
  }
  async function secondGroup(f: Awaited<ReturnType<typeof fixture>>, externalOrderId: string) {
    return (
      await pool.query<{ id: string }>(
        `INSERT INTO app.order_fulfillment_groups
      (order_id,group_key,adapter_type,provider_id,qualification_id,shipping_snapshot,status,printing_status,fulfillment_status,external_order_id)
      SELECT order_id,$2,adapter_type,provider_id,qualification_id,shipping_snapshot,'SUBMITTED','SUBMITTED','UNFULFILLED',$3
      FROM app.order_fulfillment_groups WHERE id=$1 RETURNING id`,
        [f.groupId, randomUUID(), externalOrderId],
      )
    ).rows[0]!.id;
  }

  async function productionFixture() {
    const f = await fixture('UNFULFILLED', 'READY_FOR_PRODUCTION', 'READY_FOR_PRODUCTION');
    const providerId = `cancellation-provider-${randomUUID()}`;
    await pool.query(
      `INSERT INTO app.print_providers (id,adapter_type,external_id,display_name)
      VALUES ($1,'PRINTIFY',$1,'Cancellation fixture')`,
      [providerId],
    );
    const qualificationId = (
      await pool.query<{ id: string }>(
        `INSERT INTO app.provider_qualifications
      (provider_id,product_model_id,decoration_method,qualification_status,active,technical_compatible,g3_reviewed,physical_test_status)
      SELECT $2,product_model_id,'DTG','QUALIFIED',true,true,true,'PASSED' FROM app.order_items WHERE id=$1 RETURNING id`,
        [f.itemId, providerId],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO app.provider_variants (provider_id,product_variant_id,external_variant_id)
      SELECT $2,product_variant_id,'fixture-variant' FROM app.order_items WHERE id=$1`,
      [f.itemId, providerId],
    );
    await pool.query(
      `INSERT INTO app.provider_profile_mappings (qualification_id,production_profile_id)
      SELECT $2,prepress.production_profile_id FROM app.prepress_runs prepress JOIN app.order_items item ON item.prepress_run_id=prepress.id
      WHERE item.id=$1`,
      [f.itemId, qualificationId],
    );
    await pool.query(
      `UPDATE app.order_fulfillment_groups SET qualification_id=$2,provider_id=$3 WHERE id=$1`,
      [f.groupId, qualificationId, providerId],
    );
    await pool.query(
      `UPDATE app.prepress_runs SET production_master_asset_id=preview_asset_id
      WHERE id=(SELECT prepress_run_id FROM app.order_items WHERE id=$1)`,
      [f.itemId],
    );
    const derivativeId = (
      await pool.query<{ id: string }>(
        `INSERT INTO app.provider_derivatives
      (prepress_run_id,qualification_id,production_master_asset_id,derivative_asset_id,status,requirement_snapshot)
      SELECT prepress.id,$2,prepress.preview_asset_id,prepress.preview_asset_id,'READY','{}'::jsonb FROM app.prepress_runs prepress
      JOIN app.order_items item ON item.prepress_run_id=prepress.id WHERE item.id=$1 RETURNING id`,
        [f.itemId, qualificationId],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO app.order_reviews (order_id,stage,outcome,reason_code,actor_staff_member_id)
      VALUES ($1,'PREPRESS','APPROVED','PRINTABILITY_CONCERN',$2),($1,'COMPLIANCE','APPROVED','MODERATION_REVIEW',$2)`,
      [f.orderId, staff.staffMemberId],
    );
    const policy = new domain.PolicyService(pool);
    const evaluation = await policy.evaluateFinalArtworkForOrder(f.orderNumber);
    await policy.recordHumanDecision({
      evaluationId: evaluation.id,
      orderId: f.orderId,
      actorUserId: null,
      actorStaffMemberId: staff.staffMemberId,
      decision: 'APPROVED',
      reasonCode: 'MODERATION_REVIEW',
    });
    return { ...f, qualificationId, derivativeId };
  }

  it.each([
    'PAID',
    'PREPRESS_REVIEW',
    'COMPLIANCE_REVIEW',
    'ROUTING',
    'READY_FOR_PRODUCTION',
    'FAILED',
    'IN_PRODUCTION',
    'REPRINT_REQUIRED',
    'REFUND_REQUIRED',
  ])(
    'cancels local-only %s through canonical history and leaves money/items/returns unchanged',
    async (canonical) => {
      const f = await fixture('UNFULFILLED', canonical, 'NOT_STARTED');
      const { actions, cancelOrder } = cancellationService();
      expect(actions.cancel).toBeTypeOf('function');
      const before = await snapshot(f.orderId);
      const input = cancellationInput(f.orderNumber);
      const result = await actions.cancel(staff, input);
      expect(result).toMatchObject({
        status: 'SUCCEEDED',
        orderStatus: 'CANCELLED',
        duplicate: false,
        unresolvedFulfillmentGroupIds: [],
        refund: { status: 'LATER', refundId: null },
      });
      const after = await snapshot(f.orderId);
      expect(after.order).toMatchObject({ status: 'CANCELLED', archived_at: null });
      expect(after.payments).toEqual(before.payments);
      expect(after.refunds).toEqual(before.refunds);
      expect(after.returns).toEqual(before.returns);
      expect(after.items).toEqual(before.items);
      expect(after.history).toContainEqual(
        expect.objectContaining({
          from_state: canonical,
          to_state: 'CANCELLED',
          actor_staff_member_id: staff.staffMemberId,
          reason_code: input.reasonCode,
        }),
      );
      expect(cancelOrder).not.toHaveBeenCalled();
      expect((await cancellationRows(f.orderId)).attempts).toMatchObject([
        { status: 'NOT_REQUIRED', attempt_count: 0 },
      ]);
      expect(after.groups).toMatchObject([
        { status: 'CANCELLED', printing_status: 'CANCELLED', fulfillment_status: 'CANCELLED' },
      ]);
      expect(
        (await pool.query(`SELECT id FROM app.lifecycle_deliveries WHERE order_id=$1`, [f.orderId]))
          .rows,
      ).toEqual([]);
      expect(await actions.cancel(staff, input)).toMatchObject({ ...result, duplicate: true });
      expect((await cancellationRows(f.orderId)).cancellations).toHaveLength(1);
    },
  );

  it.each([
    ['FULFILLED', 'NOT_STARTED'],
    ['DELIVERED', 'NOT_STARTED'],
    ['PARTIALLY_FULFILLED', 'NOT_STARTED'],
    ['UNFULFILLED', 'SUBMITTING'],
    ['UNFULFILLED', 'IN_PRODUCTION'],
    ['UNFULFILLED', 'PRINTED'],
  ])('rejects cancellation for %s/%s without effects', async (fulfillment, printing) => {
    const f = await fixture(fulfillment, 'PAID', printing);
    const { actions, cancelOrder } = cancellationService();
    expect(actions.cancel).toBeTypeOf('function');
    const before = await snapshot(f.orderId);
    await expect(actions.cancel(staff, cancellationInput(f.orderNumber))).rejects.toBeInstanceOf(
      domain.OrderAdminActionConflictError,
    );
    expect(await snapshot(f.orderId)).toEqual(before);
    expect(await cancellationRows(f.orderId)).toEqual({ cancellations: [], attempts: [] });
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('cancels a submitted provider group once with a durable per-group key', async () => {
    const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
    await externalGroup(f, `cancel-${randomUUID()}`);
    const { actions, cancelOrder } = cancellationService();
    expect(actions.cancel).toBeTypeOf('function');
    const input = cancellationInput(f.orderNumber);
    const result = await actions.cancel(staff, input);
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      orderStatus: 'CANCELLED',
      unresolvedFulfillmentGroupIds: [],
    });
    expect((await cancellationRows(f.orderId)).attempts).toMatchObject([
      { status: 'CANCELLED', attempt_count: 1 },
    ]);
    await expect(actions.cancel(staff, input)).resolves.toMatchObject({
      duplicate: true,
      status: 'SUCCEEDED',
    });
    expect(cancelOrder).toHaveBeenCalledOnce();
    expect(cancelOrder.mock.calls[0]![0].idempotencyKey).toBe(
      `cancel:${result.cancellationId}:${f.groupId}`,
    );
  });

  it.each(['refusal', 'timeout'])(
    'preserves the active order on provider %s and allows only explicit retry',
    async (failure) => {
      const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
      await externalGroup(f, `failure-${randomUUID()}`);
      const transport = vi.fn<domain.FulfillmentService['cancelOrder']>();
      if (failure === 'refusal')
        transport.mockResolvedValue({ state: 'UNAVAILABLE', occurredAt: null });
      else
        transport.mockRejectedValue(
          new domain.FulfillmentIntegrationError('TIMEOUT', 'Fixture timeout'),
        );
      const { actions } = cancellationService(transport);
      expect(actions.cancel).toBeTypeOf('function');
      const before = await snapshot(f.orderId);
      const input = cancellationInput(f.orderNumber);
      const result = await actions.cancel(staff, input);
      expect(result).toMatchObject({
        status: 'FAILED',
        orderStatus: 'SUBMITTED_TO_PRINTIFY',
        unresolvedFulfillmentGroupIds: [f.groupId],
      });
      expect(await snapshot(f.orderId)).toEqual(before);
      await actions.cancel(staff, input);
      expect(transport).toHaveBeenCalledOnce();
      transport.mockResolvedValue({ state: 'CANCELLED', occurredAt: null });
      expect(
        await actions.retryCancellation(staff, {
          orderNumber: f.orderNumber,
          cancellationId: result.cancellationId,
          idempotencyKey: randomUUID(),
        }),
      ).toMatchObject({ status: 'SUCCEEDED', orderStatus: 'CANCELLED' });
      expect(transport.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
        `cancel:${result.cancellationId}:${f.groupId}`,
        `cancel:${result.cancellationId}:${f.groupId}`,
      ]);
    },
  );

  it('holds partial cancellation and retries only the unresolved provider group', async () => {
    const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
    const firstExternal = `first-${randomUUID()}`;
    const secondExternal = `second-${randomUUID()}`;
    await externalGroup(f, firstExternal);
    const second = await secondGroup(f, secondExternal);
    const transport = vi
      .fn<domain.FulfillmentService['cancelOrder']>()
      .mockImplementation(async ({ externalOrderId }) => ({
        state: externalOrderId === firstExternal ? 'CANCELLED' : 'UNAVAILABLE',
        occurredAt: null,
      }));
    const { actions } = cancellationService(transport);
    expect(actions.cancel).toBeTypeOf('function');
    const result = await actions.cancel(staff, cancellationInput(f.orderNumber));
    expect(result).toMatchObject({
      status: 'PARTIAL',
      orderStatus: 'ON_HOLD',
      unresolvedFulfillmentGroupIds: [second],
    });
    expect((await snapshot(f.orderId)).order).toMatchObject({ status: 'ON_HOLD' });
    expect(
      (
        await pool.query(
          `SELECT previous_state,reason_code FROM app.order_holds WHERE order_id=$1 AND resumed_at IS NULL`,
          [f.orderId],
        )
      ).rows,
    ).toEqual([
      { previous_state: 'SUBMITTED_TO_PRINTIFY', reason_code: 'CUSTOMER_CANCELLATION_REQUEST' },
    ]);
    expect(transport).toHaveBeenCalledTimes(2);
    transport.mockResolvedValue({ state: 'CANCELLED', occurredAt: null });
    const retry = {
      orderNumber: f.orderNumber,
      cancellationId: result.cancellationId,
      idempotencyKey: randomUUID(),
    };
    expect(await actions.retryCancellation(staff, retry)).toMatchObject({
      status: 'SUCCEEDED',
      orderStatus: 'CANCELLED',
      unresolvedFulfillmentGroupIds: [],
    });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls[2]![0]).toEqual({
      externalOrderId: secondExternal,
      idempotencyKey: `cancel:${result.cancellationId}:${second}`,
    });
    expect(await actions.retryCancellation(staff, retry)).toMatchObject({
      status: 'SUCCEEDED',
      duplicate: true,
    });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('holds a REFUND_REQUIRED partial cancellation without widening ordinary hold transitions', async () => {
    const f = await fixture('UNFULFILLED', 'REFUND_REQUIRED', 'SUBMITTED');
    const firstExternal = `refund-hold-first-${randomUUID()}`;
    await externalGroup(f, firstExternal);
    const unresolvedId = await secondGroup(f, `refund-hold-second-${randomUUID()}`);
    const { actions, operations } = cancellationService(
      vi.fn<domain.FulfillmentService['cancelOrder']>().mockImplementation(async (input) => ({
        state: input.externalOrderId === firstExternal ? 'CANCELLED' : 'UNAVAILABLE',
        occurredAt: null,
      })),
    );
    await expect(operations.hold(staff, f.orderNumber, 'PRINTABILITY_CONCERN')).rejects.toThrow(
      'Cannot move REFUND_REQUIRED to ON_HOLD',
    );
    const before = await snapshot(f.orderId);
    const result = await actions.cancel(staff, cancellationInput(f.orderNumber));
    expect(result).toMatchObject({
      status: 'PARTIAL',
      orderStatus: 'ON_HOLD',
      unresolvedFulfillmentGroupIds: [unresolvedId],
    });
    expect((await cancellationRows(f.orderId)).cancellations).toMatchObject([
      { status: 'PARTIAL' },
    ]);
    expect(
      (
        await pool.query(`SELECT previous_state FROM app.order_holds WHERE order_id=$1`, [
          f.orderId,
        ])
      ).rows,
    ).toEqual([{ previous_state: 'REFUND_REQUIRED' }]);
    const after = await snapshot(f.orderId);
    expect(after.payments).toEqual(before.payments);
    expect(after.refunds).toEqual(before.refunds);
    expect(after.returns).toEqual(before.returns);
    expect(after.items).toEqual(before.items);
  });

  it('completes refund and notification with a one-connection cancellation pool', async () => {
    const f = await fixture('UNFULFILLED', 'PAID', 'NOT_STARTED');
    const isolated = createDatabaseClient(integrationDatabaseUrl!);
    isolated.pool.options.max = 1;
    // Bound the expected RED pool starvation without leaving a hung test worker.
    isolated.pool.options.connectionTimeoutMillis = 1000;
    const send = vi.fn<domain.LifecycleMessagingService['send']>().mockResolvedValue({
      providerMessageId: 'one-connection-cancellation',
    });
    const { actions } = cancellationService(undefined, {
      pool: isolated.pool,
      lifecycle: new domain.LifecycleOrchestrator(isolated.pool, { send }),
    });
    const input = {
      ...cancellationInput(f.orderNumber),
      refundDestination: 'ORIGINAL_PAYMENT' as const,
      refundAmountCents: 500,
      notifyCustomer: true,
    };
    try {
      const result = await actions.cancel(staff, input);
      expect(result).toMatchObject({
        status: 'SUCCEEDED',
        orderStatus: 'CANCELLED',
        refund: { status: 'SUCCEEDED', amountCents: 500 },
      });
      expect((await cancellationRows(f.orderId)).cancellations).toHaveLength(1);
      expect((await snapshot(f.orderId)).refunds).toMatchObject([
        { status: 'SUCCEEDED', amount_cents: 500 },
      ]);
      expect(
        (
          await pool.query(`SELECT status FROM app.lifecycle_deliveries WHERE order_id=$1`, [
            f.orderId,
          ])
        ).rows,
      ).toEqual([{ status: 'SENT' }]);
      expect(await actions.cancel(staff, input)).toMatchObject({
        duplicate: true,
        refund: { status: 'SUCCEEDED' },
      });
      expect(send).toHaveBeenCalledOnce();
      expect(isolated.pool.waitingCount).toBe(0);
    } finally {
      await isolated.close();
    }
  });

  it.each(['ORIGINAL_PAYMENT', 'STORE_CREDIT'] as const)(
    'executes %s refund after canonical cancellation exactly once',
    async (destination) => {
      const f = await fixture('UNFULFILLED', 'PAID', 'NOT_STARTED');
      const payments = new domain.FakePaymentService();
      const refund = vi.spyOn(payments, 'refund').mockImplementation(async () => {
        expect((await snapshot(f.orderId)).order).toMatchObject({ status: 'CANCELLED' });
        return { providerRefundId: `refund-${randomUUID()}` };
      });
      const { actions } = cancellationService(undefined, { payments });
      const before = await snapshot(f.orderId);
      const input = {
        ...cancellationInput(f.orderNumber),
        refundDestination: destination,
        refundAmountCents: 500,
      };
      const result = await actions.cancel(staff, input);
      expect(result).toMatchObject({
        status: 'SUCCEEDED',
        orderStatus: 'CANCELLED',
        refund: {
          destination,
          amountCents: 500,
          status: 'SUCCEEDED',
          refundId: expect.any(String),
          retryable: false,
        },
      });
      const after = await snapshot(f.orderId);
      expect(after.payments).toEqual(before.payments);
      expect(after.items).toEqual(before.items);
      expect(after.returns).toEqual(before.returns);
      expect(after.refunds).toMatchObject([
        {
          amount_cents: 500,
          destination,
          status: 'SUCCEEDED',
          initiated_by_staff_member_id: staff.staffMemberId,
        },
      ]);
      if (destination === 'STORE_CREDIT') {
        expect(after.refunds[0]).toMatchObject({
          provider: null,
          store_credit_ledger_entry_id: expect.any(String),
        });
        expect(
          (
            await pool.query(
              `SELECT amount_cents,reason FROM app.store_credit_ledger WHERE id=$1`,
              [after.refunds[0]!.store_credit_ledger_entry_id],
            )
          ).rows,
        ).toEqual([{ amount_cents: 500, reason: 'REFUND' }]);
        expect(refund).not.toHaveBeenCalled();
      } else expect(refund).toHaveBeenCalledOnce();
      expect(await actions.cancel(staff, input)).toMatchObject({ ...result, duplicate: true });
      expect((await snapshot(f.orderId)).refunds).toHaveLength(1);
    },
  );

  it('reports payment failure separately and preserves an actionable manual refund after cancellation', async () => {
    const f = await fixture('UNFULFILLED', 'PAID', 'NOT_STARTED');
    const payments = new domain.FakePaymentService();
    const refund = vi
      .spyOn(payments, 'refund')
      .mockRejectedValue(new Error('Fixture payment transport unavailable'));
    const { actions, refunds } = cancellationService(undefined, { payments });
    const input = {
      ...cancellationInput(f.orderNumber),
      refundDestination: 'ORIGINAL_PAYMENT' as const,
      refundAmountCents: 500,
    };
    const result = await actions.cancel(staff, input);
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      orderStatus: 'CANCELLED',
      refund: { status: 'FAILED', retryable: true },
    });
    expect((await snapshot(f.orderId)).refunds).toMatchObject([
      { status: 'FAILED', amount_cents: 500 },
    ]);
    expect(await actions.cancel(staff, input)).toMatchObject({ ...result, duplicate: true });
    expect(refund).toHaveBeenCalledOnce();
    expect(
      (
        await pool.query(
          `SELECT metadata FROM app.order_operational_audits WHERE order_id=$1
      AND action='order_cancellation_refund_failed'`,
          [f.orderId],
        )
      ).rows,
    ).toMatchObject([
      {
        metadata: {
          cancellationId: result.cancellationId,
          destination: 'ORIGINAL_PAYMENT',
          refundStatus: 'FAILED',
        },
      },
    ]);
    refund.mockResolvedValue({ providerRefundId: `recovered-${randomUUID()}` });
    expect(
      await refunds.refundOriginalPayment(
        {
          type: 'STAFF',
          staffMemberId: staff.staffMemberId,
          role: 'OPERATIONS',
          email: staff.email,
        },
        {
          orderNumber: f.orderNumber,
          amountCents: 500,
          reasonCode: 'CANCELLED',
          idempotencyKey: randomUUID(),
        },
      ),
    ).toMatchObject({ status: 'SUCCEEDED' });
    expect((await snapshot(f.orderId)).order).toMatchObject({ status: 'CANCELLED' });
  });

  it('keeps non-USD Store Credit unavailable without undoing the separate cancellation', async () => {
    const f = await fixture('UNFULFILLED', 'PAID', 'NOT_STARTED');
    await pool.query(
      `UPDATE app.payments SET currency='EUR' WHERE checkout_attempt_id=(SELECT checkout_attempt_id FROM app.orders WHERE id=$1)`,
      [f.orderId],
    );
    const { actions } = cancellationService();
    const result = await actions.cancel(staff, {
      ...cancellationInput(f.orderNumber),
      refundDestination: 'STORE_CREDIT',
      refundAmountCents: 500,
    });
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      orderStatus: 'CANCELLED',
      refund: { status: 'FAILED', refundId: null, retryable: true },
    });
    expect((await snapshot(f.orderId)).refunds).toEqual([]);
  });

  it.each(['sent', 'failed'] as const)(
    'commits notification intent before dispatch and exposes %s delivery in the timeline',
    async (outcome) => {
      const f = await fixture('UNFULFILLED', 'PAID', 'NOT_STARTED');
      const send = vi
        .fn<domain.LifecycleMessagingService['send']>()
        .mockImplementation(async (input) => {
          expect((await snapshot(f.orderId)).order).toMatchObject({ status: 'CANCELLED' });
          const rows = (
            await pool.query(
              `SELECT status,payload FROM app.lifecycle_deliveries WHERE order_id=$1`,
              [f.orderId],
            )
          ).rows;
          expect(rows).toMatchObject([
            { status: 'RETRYING', payload: { preferredLocale: 'en', orderNumber: f.orderNumber } },
          ]);
          expect(input).toMatchObject({
            type: 'ORDER_CANCELLATION',
            preferredLocale: 'en',
            classification: 'TRANSACTIONAL',
          });
          expect(input.payload).not.toHaveProperty('staffNote');
          if (outcome === 'failed') throw new Error('Fixture email unavailable');
          return { providerMessageId: 'cancellation-mail' };
        });
      const lifecycle = new domain.LifecycleOrchestrator(actionDatabase.pool, { send });
      const { actions } = cancellationService(undefined, { lifecycle });
      const input = { ...cancellationInput(f.orderNumber), notifyCustomer: true };
      const result = await actions.cancel(staff, input);
      expect(result).toMatchObject({ status: 'SUCCEEDED', orderStatus: 'CANCELLED' });
      expect(send).toHaveBeenCalledOnce();
      expect(
        (
          await pool.query(
            `SELECT status,payload FROM app.lifecycle_deliveries WHERE order_id=$1`,
            [f.orderId],
          )
        ).rows,
      ).toMatchObject([
        {
          status: outcome.toUpperCase(),
          payload: { preferredLocale: 'en', cancellationId: result.cancellationId },
        },
      ]);
      const timeline = await new domain.OrderDetailService(pool).listTimeline(staff, f.orderNumber);
      expect(timeline.events).toContainEqual(
        expect.objectContaining({ type: `MESSAGE_${outcome.toUpperCase()}` }),
      );
      await actions.cancel(staff, input);
      expect(send).toHaveBeenCalledOnce();
    },
  );

  it.each([false, true])(
    'rolls canonical finalization back when its outbox cannot persist, then recovers without recalling confirmed providers (new production evidence: %s)',
    async (newProductionEvidence) => {
      const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
      await externalGroup(f, `outbox-${randomUUID()}`);
      const { actions, cancelOrder } = cancellationService();
      const input = { ...cancellationInput(f.orderNumber), notifyCustomer: true };
      const name = `cancel_outbox_${randomUUID().replaceAll('-', '')}`;
      await pool.query(`CREATE FUNCTION app.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.order_id='${f.orderId}'::uuid THEN RAISE EXCEPTION 'fixture outbox unavailable'; END IF; RETURN NEW; END; $$`);
      try {
        await pool.query(
          `CREATE TRIGGER ${name} BEFORE INSERT ON app.lifecycle_deliveries FOR EACH ROW EXECUTE FUNCTION app.${name}()`,
        );
        await expect(actions.cancel(staff, input)).rejects.toThrow('fixture outbox unavailable');
        expect((await snapshot(f.orderId)).order).toMatchObject({
          status: 'SUBMITTED_TO_PRINTIFY',
        });
        expect(await cancellationRows(f.orderId)).toMatchObject({
          cancellations: [{ status: 'PROCESSING' }],
          attempts: [{ status: 'CANCELLED' }],
        });
        expect(
          (
            await pool.query(`SELECT * FROM app.lifecycle_deliveries WHERE order_id=$1`, [
              f.orderId,
            ])
          ).rows,
        ).toEqual([]);
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${name} ON app.lifecycle_deliveries`);
        await pool.query(`DROP FUNCTION app.${name}()`);
      }
      if (newProductionEvidence) {
        await pool.query(`UPDATE app.orders SET status='IN_PRODUCTION' WHERE id=$1`, [f.orderId]);
        await pool.query(
          `UPDATE app.order_fulfillment_groups SET printing_status='IN_PRODUCTION' WHERE id=$1`,
          [f.groupId],
        );
      }
      expect(await actions.cancel(staff, input)).toMatchObject({
        status: newProductionEvidence ? 'PARTIAL' : 'SUCCEEDED',
        orderStatus: newProductionEvidence ? 'ON_HOLD' : 'CANCELLED',
      });
      expect(cancelOrder).toHaveBeenCalledOnce();
    },
  );

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((complete) => {
      resolve = complete;
    });
    return { promise, resolve };
  }

  it('fails closed after worker session loss while the original provider POST is pending', async () => {
    const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
    const externalOrderId = `session-loss-${randomUUID()}`;
    await externalGroup(f, externalOrderId);
    const workerName = `cancel-lost-worker-${randomUUID()}`;
    const workerUrl = new URL(integrationDatabaseUrl!);
    workerUrl.searchParams.set('application_name', workerName);
    const isolated = createDatabaseClient(workerUrl.toString());
    const disconnected = deferred<void>();
    isolated.pool.on('connect', (client) => client.on('error', () => disconnected.resolve()));
    const entered = deferred<void>();
    const release = deferred<void>();
    let postCount = 0;
    let providerState = 'on-hold';
    let originalPostPending = true;
    const transport: typeof fetch = async (url, init) => {
      const request = new Request(url, init);
      if (request.method === 'POST') {
        postCount += 1;
        if (postCount === 1) {
          entered.resolve();
          await release.promise;
          originalPostPending = false;
          providerState = 'canceled';
        }
        return Response.json({ id: externalOrderId, status: 'canceled' });
      }
      return Response.json({ id: externalOrderId, status: providerState });
    };
    const adapter = () =>
      new domain.PrintifyFulfillmentAdapter({
        apiToken: 'fixture-only',
        shopId: 'session-loss-shop',
        baseUrl: 'https://print.example.test/v1',
        fetch: transport,
      });
    const worker = cancellationService(undefined, { pool: isolated.pool, fulfillment: adapter() });
    // Different adapter instance/process boundary: no in-memory cancellation map is shared.
    const successor = cancellationService(undefined, { fulfillment: adapter() });
    const original = Promise.allSettled([
      worker.actions.cancel(staff, cancellationInput(f.orderNumber)),
    ]);
    try {
      await entered.promise;
      const cancellationId = (await cancellationRows(f.orderId)).cancellations[0]!.id;
      const killed = await pool.query(
        `SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE application_name=$1`,
        [workerName],
      );
      expect(killed.rows).toEqual([{ terminated: true }]);
      await disconnected.promise;
      for (let retry = 0; retry < 2; retry += 1) {
        const result = await successor.actions.retryCancellation(staff, {
          orderNumber: f.orderNumber,
          cancellationId,
          idempotencyKey: randomUUID(),
        });
        expect(postCount).toBe(1);
        expect(originalPostPending).toBe(true);
        expect(result).toMatchObject({
          status: 'FAILED',
          orderStatus: 'SUBMITTED_TO_PRINTIFY',
          unresolvedFulfillmentGroupIds: [f.groupId],
          ambiguousFulfillmentGroupIds: [f.groupId],
        });
        expect((await cancellationRows(f.orderId)).attempts).toMatchObject([
          {
            status: 'REQUESTED',
            attempt_count: 1,
            provider_error_code: 'CANCELLATION_OUTCOME_UNKNOWN',
            response_metadata: { requiresManualResolution: true },
          },
        ]);
      }
      await expect(successor.operations.submitProduction(staff, f.orderNumber)).rejects.toThrow(
        'Cancellation must be resolved',
      );
      release.resolve();
      expect(await original).toMatchObject([{ status: 'rejected' }]);
      expect(
        await successor.actions.retryCancellation(staff, {
          orderNumber: f.orderNumber,
          cancellationId,
          idempotencyKey: randomUUID(),
        }),
      ).toMatchObject({
        status: 'SUCCEEDED',
        orderStatus: 'CANCELLED',
        ambiguousFulfillmentGroupIds: [],
      });
      expect((await cancellationRows(f.orderId)).attempts).toMatchObject([
        {
          status: 'CANCELLED',
          attempt_count: 1,
          provider_error_code: null,
        },
      ]);
      expect(postCount).toBe(1);
    } finally {
      release.resolve();
      await original;
      await isolated.close();
    }
  });

  it.each(['mismatched', 'missing'] as const)(
    'keeps recovery ambiguous without settlement for a %s provider response ID',
    async (identity) => {
      const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
      const externalOrderId = `unconfirmed-identity-${randomUUID()}`;
      await externalGroup(f, externalOrderId);
      // Durable state from a started worker with no recorded provider result.
      const cancellationId = (
        await pool.query<{ id: string }>(
          `INSERT INTO app.order_cancellations
        (order_id,status,refund_destination,refund_amount_cents,reason_code,notify_customer,initiated_by_staff_member_id,idempotency_key)
        VALUES ($1,'PROCESSING','ORIGINAL_PAYMENT',500,'CUSTOMER_CANCELLATION_REQUEST',true,$2,$3) RETURNING id`,
          [f.orderId, staff.staffMemberId, randomUUID()],
        )
      ).rows[0]!.id;
      await pool.query(
        `INSERT INTO app.order_cancellation_groups
        (order_cancellation_id,fulfillment_group_id,external_order_id,status,attempt_count,last_attempt_at)
        VALUES ($1,$2,$3,'REQUESTED',1,now())`,
        [cancellationId, f.groupId, externalOrderId],
      );
      const methods: string[] = [];
      const fulfillment = new domain.PrintifyFulfillmentAdapter({
        apiToken: 'fixture-only-secret',
        shopId: 'identity-fixture',
        baseUrl: 'https://print.example.test/v1',
        fetch: async (url, init) => {
          methods.push(new Request(url, init).method);
          return Response.json({
            ...(identity === 'mismatched' ? { id: 'another-private-order' } : {}),
            status: 'canceled',
            customer: { email: 'private-provider-customer@example.test' },
          });
        },
      });
      const payments = new domain.FakePaymentService();
      const refund = vi.spyOn(payments, 'refund');
      const send = vi.fn<domain.LifecycleMessagingService['send']>().mockResolvedValue({
        providerMessageId: 'must-not-send',
      });
      const { actions } = cancellationService(undefined, {
        fulfillment,
        payments,
        lifecycle: new domain.LifecycleOrchestrator(pool, { send }),
      });
      const before = await snapshot(f.orderId);
      const result = await actions.retryCancellation(staff, {
        orderNumber: f.orderNumber,
        cancellationId,
        idempotencyKey: randomUUID(),
      });
      expect(result).toMatchObject({
        status: 'FAILED',
        orderStatus: 'SUBMITTED_TO_PRINTIFY',
        unresolvedFulfillmentGroupIds: [f.groupId],
        ambiguousFulfillmentGroupIds: [f.groupId],
      });
      expect((await cancellationRows(f.orderId)).attempts).toMatchObject([
        {
          status: 'REQUESTED',
          attempt_count: 1,
          provider_error_code: 'CANCELLATION_OUTCOME_UNKNOWN',
          response_metadata: {
            requiresManualResolution: true,
            reconciliationErrorCode: 'INVALID_RESPONSE',
          },
        },
      ]);
      expect(methods).toEqual(['GET']);
      expect(await snapshot(f.orderId)).toEqual(before);
      expect(refund).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(
        (await pool.query(`SELECT id FROM app.lifecycle_deliveries WHERE order_id=$1`, [f.orderId]))
          .rows,
      ).toEqual([]);
      const audits = (
        await pool.query(`SELECT metadata FROM app.order_operational_audits WHERE order_id=$1`, [
          f.orderId,
        ])
      ).rows;
      expect(JSON.stringify(audits)).not.toContain('another-private-order');
      expect(JSON.stringify(audits)).not.toContain('private-provider-customer');
    },
  );

  it('serializes live duplicate cancellation and retry calls with a database worker claim', async () => {
    const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
    await externalGroup(f, `concurrent-${randomUUID()}`);
    const entered = deferred<void>();
    const release = deferred<void>();
    const transport = vi
      .fn<domain.FulfillmentService['cancelOrder']>()
      .mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        return { state: 'CANCELLED', occurredAt: null };
      });
    const { actions } = cancellationService(transport);
    const input = cancellationInput(f.orderNumber);
    const operation = actions.cancel(staff, input);
    try {
      await entered.promise;
      const rows = await cancellationRows(f.orderId);
      expect(rows).toMatchObject({
        cancellations: [{ status: 'PROCESSING' }],
        attempts: [{ status: 'REQUESTED', attempt_count: 1 }],
      });
      const concurrent = cancellationService(transport).actions;
      expect(await concurrent.cancel(staff, input)).toMatchObject({
        status: 'PROCESSING',
        orderStatus: 'SUBMITTED_TO_PRINTIFY',
        duplicate: true,
      });
      expect(
        await concurrent.retryCancellation(staff, {
          orderNumber: f.orderNumber,
          cancellationId: rows.cancellations[0]!.id,
          idempotencyKey: randomUUID(),
        }),
      ).toMatchObject({ status: 'PROCESSING', duplicate: true });
      expect(transport).toHaveBeenCalledOnce();
      const worker = await pool.query(
        `SELECT activity.state FROM pg_locks locks JOIN pg_stat_activity activity ON activity.pid=locks.pid
        WHERE locks.locktype='advisory' AND locks.granted AND activity.application_name=$1 AND activity.state='idle'`,
        [applicationName],
      );
      expect(worker.rows.length).toBeGreaterThan(0);
    } finally {
      release.resolve();
    }
    expect(await operation).toMatchObject({
      status: 'SUCCEEDED',
      orderStatus: 'CANCELLED',
      duplicate: false,
    });
    expect((await cancellationRows(f.orderId)).cancellations).toHaveLength(1);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('serializes concurrent retries and never calls the already-cancelled provider again', async () => {
    const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
    const first = `retry-first-${randomUUID()}`;
    const second = `retry-second-${randomUUID()}`;
    await externalGroup(f, first);
    const secondId = await secondGroup(f, second);
    const transport = vi
      .fn<domain.FulfillmentService['cancelOrder']>()
      .mockImplementation(async ({ externalOrderId }) => ({
        state: externalOrderId === first ? 'CANCELLED' : 'UNAVAILABLE',
        occurredAt: null,
      }));
    const { actions } = cancellationService(transport);
    const partial = await actions.cancel(staff, cancellationInput(f.orderNumber));
    const entered = deferred<void>();
    const release = deferred<void>();
    transport.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return { state: 'CANCELLED', occurredAt: null };
    });
    const retry = {
      orderNumber: f.orderNumber,
      cancellationId: partial.cancellationId,
      idempotencyKey: randomUUID(),
    };
    const operation = actions.retryCancellation(staff, retry);
    try {
      await entered.promise;
      expect(
        await cancellationService(transport).actions.retryCancellation(staff, retry),
      ).toMatchObject({
        status: 'PROCESSING',
        duplicate: true,
        unresolvedFulfillmentGroupIds: [secondId],
      });
    } finally {
      release.resolve();
    }
    expect(await operation).toMatchObject({ status: 'SUCCEEDED', orderStatus: 'CANCELLED' });
    expect(
      transport.mock.calls.map(([input]) => input.externalOrderId).filter((id) => id === first),
    ).toHaveLength(1);
    expect(
      transport.mock.calls.map(([input]) => input.externalOrderId).filter((id) => id === second),
    ).toHaveLength(2);
  });

  it('blocks both production entry points and hold resumption while a cancellation needs resolution', async () => {
    const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
    const first = `blocked-first-${randomUUID()}`;
    await externalGroup(f, first);
    await secondGroup(f, `blocked-second-${randomUUID()}`);
    const transport = vi
      .fn<domain.FulfillmentService['cancelOrder']>()
      .mockImplementation(async ({ externalOrderId }) => ({
        state: externalOrderId === first ? 'CANCELLED' : 'UNAVAILABLE',
        occurredAt: null,
      }));
    const { actions, operations } = cancellationService(transport);
    expect(await actions.cancel(staff, cancellationInput(f.orderNumber))).toMatchObject({
      status: 'PARTIAL',
      orderStatus: 'ON_HOLD',
    });
    const before = await snapshot(f.orderId);
    await expect(operations.submitProduction(staff, f.orderNumber)).rejects.toThrow(
      'Cancellation must be resolved before production can continue.',
    );
    await expect(
      operations.submitFulfillmentGroup(staff, {
        orderNumber: f.orderNumber,
        fulfillmentGroupId: f.groupId,
      }),
    ).rejects.toThrow('Cancellation must be resolved before production can continue.');
    await expect(operations.resume(staff, f.orderNumber)).rejects.toThrow(
      'Cancellation must be resolved before production can continue.',
    );
    expect(await snapshot(f.orderId)).toEqual(before);
  });

  it.each(['IN_PRODUCTION', 'SHIPPED', 'DELIVERED'])(
    'revalidates provider-era %s evidence and holds a conflicting cancellation without rewinding Printing',
    async (canonical) => {
      const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
      await externalGroup(f, `stale-${randomUUID()}`);
      const { actions, operations } = cancellationService(
        vi.fn<domain.FulfillmentService['cancelOrder']>().mockImplementation(async () => {
          await pool.query(
            `UPDATE app.order_fulfillment_groups SET printing_status=$2,fulfillment_status=$3 WHERE id=$1`,
            [
              f.groupId,
              canonical === 'IN_PRODUCTION' ? 'IN_PRODUCTION' : 'PRINTED',
              canonical === 'IN_PRODUCTION'
                ? 'UNFULFILLED'
                : canonical === 'SHIPPED'
                  ? 'FULFILLED'
                  : 'DELIVERED',
            ],
          );
          await pool.query(`UPDATE app.orders SET status=$2 WHERE id=$1`, [f.orderId, canonical]);
          return { state: 'CANCELLED', occurredAt: null };
        }),
      );
      const result = await actions.cancel(staff, cancellationInput(f.orderNumber));
      expect(result).toMatchObject({
        status: 'PARTIAL',
        orderStatus: 'ON_HOLD',
        unresolvedFulfillmentGroupIds: [f.groupId],
      });
      expect((await snapshot(f.orderId)).groups).toMatchObject([
        {
          printing_status: canonical === 'IN_PRODUCTION' ? 'IN_PRODUCTION' : 'PRINTED',
          fulfillment_status:
            canonical === 'IN_PRODUCTION'
              ? 'UNFULFILLED'
              : canonical === 'SHIPPED'
                ? 'FULFILLED'
                : 'DELIVERED',
        },
      ]);
      await expect(operations.resume(staff, f.orderNumber)).rejects.toThrow(
        'Cancellation must be resolved',
      );
    },
  );

  it('locks current order/group evidence before reservation and rejects a production action already in flight', async () => {
    const f = await fixture('UNFULFILLED', 'READY_FOR_PRODUCTION', 'READY_FOR_PRODUCTION');
    await pool.query(
      `INSERT INTO app.order_fulfillment_actions
      (order_id,fulfillment_group_id,action,idempotency_key,status,attempt_count,requested_by_staff_member_id)
      VALUES ($1,$2,'CREATE_EXTERNAL_ORDER',$3,'PROCESSING',1,$4)`,
      [f.orderId, f.groupId, randomUUID(), staff.staffMemberId],
    );
    const { actions, cancelOrder } = cancellationService();
    await expect(actions.cancel(staff, cancellationInput(f.orderNumber))).rejects.toBeInstanceOf(
      domain.OrderAdminActionConflictError,
    );
    expect(await cancellationRows(f.orderId)).toEqual({ cancellations: [], attempts: [] });
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it.each(['order', 'group'])(
    'waits for the %s lock and refuses fresh cancellation-ineligible evidence',
    async (locked) => {
      const f = await fixture('UNFULFILLED', 'PAID', 'NOT_STARTED');
      const { actions, cancelOrder } = cancellationService();
      const holder = await pool.connect();
      let operation: Promise<PromiseSettledResult<domain.CancelOrderResult>[]> | undefined;
      try {
        await holder.query('BEGIN');
        await holder.query(
          locked === 'order'
            ? `SELECT id FROM app.orders WHERE id=$1 FOR UPDATE`
            : `SELECT id FROM app.order_fulfillment_groups WHERE order_id=$1 FOR UPDATE`,
          [f.orderId],
        );
        operation = Promise.allSettled([actions.cancel(staff, cancellationInput(f.orderNumber))]);
        await waitForDatabaseLock();
        await holder.query(
          `UPDATE app.order_fulfillment_groups SET printing_status='IN_PRODUCTION' WHERE order_id=$1`,
          [f.orderId],
        );
        await holder.query('COMMIT');
        expect(await operation).toMatchObject([
          { status: 'rejected', reason: expect.any(domain.OrderAdminActionConflictError) },
        ]);
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
        await operation;
      }
      expect(await cancellationRows(f.orderId)).toEqual({ cancellations: [], attempts: [] });
      expect(cancelOrder).not.toHaveBeenCalled();
    },
  );

  it('revalidates every provider claim and skips a group that starts production during an earlier cancellation', async () => {
    const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
    await externalGroup(f, `per-claim-one-${randomUUID()}`);
    await secondGroup(f, `per-claim-two-${randomUUID()}`);
    const groups = (
      await pool.query<{ id: string; external_order_id: string }>(
        `SELECT id,external_order_id FROM app.order_fulfillment_groups
      WHERE order_id=$1 ORDER BY id`,
        [f.orderId],
      )
    ).rows;
    const transport = vi
      .fn<domain.FulfillmentService['cancelOrder']>()
      .mockImplementation(async () => {
        await pool.query(
          `UPDATE app.order_fulfillment_groups SET printing_status='IN_PRODUCTION' WHERE id=$1`,
          [groups[1]!.id],
        );
        await pool.query(`UPDATE app.orders SET status='IN_PRODUCTION' WHERE id=$1`, [f.orderId]);
        return { state: 'CANCELLED', occurredAt: null };
      });
    const result = await cancellationService(transport).actions.cancel(
      staff,
      cancellationInput(f.orderNumber),
    );
    expect(result).toMatchObject({
      status: 'PARTIAL',
      orderStatus: 'ON_HOLD',
      unresolvedFulfillmentGroupIds: [groups[1]!.id],
    });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]![0].externalOrderId).toBe(groups[0]!.external_order_id);
    expect((await cancellationRows(f.orderId)).attempts).toMatchObject([
      { status: 'CANCELLED', attempt_count: 1 },
      { status: 'FAILED', attempt_count: 0, provider_error_code: 'ORDER_NO_LONGER_ELIGIBLE' },
    ]);
  });

  it('cancels a legacy external order created before its single group acquired the provider reference', async () => {
    const f = await productionFixture();
    const external = `legacy-cancel-${randomUUID()}`;
    await pool.query(
      `INSERT INTO app.external_fulfillment_orders
      (order_id,adapter_type,qualification_id,provider_derivative_id,external_order_id,provider_snapshot)
      VALUES ($1,'PRINTIFY',$2,$3,$4,'{}'::jsonb)`,
      [f.orderId, f.qualificationId, f.derivativeId, external],
    );
    const { actions, cancelOrder } = cancellationService();
    const result = await actions.cancel(staff, cancellationInput(f.orderNumber));
    expect(result).toMatchObject({ status: 'SUCCEEDED', orderStatus: 'CANCELLED' });
    expect(cancelOrder).toHaveBeenCalledOnce();
    expect(cancelOrder.mock.calls[0]![0].externalOrderId).toBe(external);
    expect(
      (
        await pool.query(
          `SELECT submission_state FROM app.external_fulfillment_orders WHERE order_id=$1`,
          [f.orderId],
        )
      ).rows,
    ).toEqual([{ submission_state: 'CANCELLED' }]);
  });

  it('takes the order lock before the group when persisting readiness', async () => {
    const f = await fixture('UNFULFILLED', 'READY_FOR_PRODUCTION', 'READY_FOR_PRODUCTION');
    const { operations } = cancellationService();
    const holder = await pool.connect();
    let operation: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT id FROM app.orders WHERE id=$1 FOR UPDATE`, [f.orderId]);
      operation = Promise.allSettled([
        operations.evaluateFulfillmentGroupReadiness(staff, {
          orderNumber: f.orderNumber,
          fulfillmentGroupId: f.groupId,
        }),
      ]);
      await waitForDatabaseLock();
      await expect(
        holder.query(`SELECT id FROM app.order_fulfillment_groups WHERE id=$1 FOR UPDATE NOWAIT`, [
          f.groupId,
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
      await operation;
    }
    expect(await operation).toMatchObject([{ status: 'fulfilled' }]);
  });

  it('takes the order lock before committing a newly created group provider reference', async () => {
    const f = await productionFixture();
    const fulfillment = new ArchiveFixtureFulfillment();
    const entered = deferred<void>();
    const release = deferred<void>();
    const createOrder = fulfillment.createOrder.bind(fulfillment);
    fulfillment.createOrder = vi
      .fn<domain.FulfillmentService['createOrder']>()
      .mockImplementation(async (input) => {
        entered.resolve();
        await release.promise;
        return createOrder(input);
      });
    const operations = new domain.OrderOperationsService(
      actionDatabase.pool,
      new MemoryObjectStorage(),
      fulfillment,
      { fulfillmentAdapter: 'fake', realProductionSubmissionEnabled: false },
    );
    expect(
      await operations.evaluateFulfillmentGroupReadiness(staff, {
        orderNumber: f.orderNumber,
        fulfillmentGroupId: f.groupId,
      }),
    ).toEqual({ ready: true, blockers: [] });
    const operation = Promise.allSettled([
      operations.submitFulfillmentGroup(staff, {
        orderNumber: f.orderNumber,
        fulfillmentGroupId: f.groupId,
      }),
    ]);
    const holder = await pool.connect();
    try {
      await entered.promise;
      await holder.query('BEGIN');
      await holder.query(`SELECT id FROM app.orders WHERE id=$1 FOR UPDATE`, [f.orderId]);
      release.resolve();
      await waitForDatabaseLock();
      await expect(
        holder.query(`SELECT id FROM app.order_fulfillment_groups WHERE id=$1 FOR UPDATE NOWAIT`, [
          f.groupId,
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });
      expect(
        (
          await pool.query(
            `SELECT external_order_id FROM app.order_fulfillment_groups WHERE id=$1`,
            [f.groupId],
          )
        ).rows,
      ).toEqual([{ external_order_id: null }]);
    } finally {
      release.resolve();
      await holder.query('ROLLBACK');
      holder.release();
      await operation;
    }
    const completed = await operation;
    expect(
      completed.filter((result) => result.status === 'rejected').map((result) => result.reason),
    ).toEqual([]);
    expect(completed).toMatchObject([
      { status: 'fulfilled', value: { duplicate: false, externalOrderId: expect.any(String) } },
    ]);
  });

  it.each([false, true])(
    'does not refund or notify when provider cancellation remains unresolved (partial: %s)',
    async (partial) => {
      const f = await fixture('UNFULFILLED', 'SUBMITTED_TO_PRINTIFY', 'SUBMITTED');
      const first = `no-effects-${randomUUID()}`;
      await externalGroup(f, first);
      const second = await secondGroup(f, `no-effects-second-${randomUUID()}`);
      const transport = vi
        .fn<domain.FulfillmentService['cancelOrder']>()
        .mockImplementation(async ({ externalOrderId }) => ({
          state: partial && externalOrderId === first ? 'CANCELLED' : 'UNAVAILABLE',
          occurredAt: null,
        }));
      const before = await snapshot(f.orderId);
      const result = await cancellationService(transport).actions.cancel(staff, {
        ...cancellationInput(f.orderNumber),
        refundDestination: 'ORIGINAL_PAYMENT',
        refundAmountCents: 500,
        notifyCustomer: true,
      });
      expect(result).toMatchObject({
        status: partial ? 'PARTIAL' : 'FAILED',
        orderStatus: partial ? 'ON_HOLD' : 'SUBMITTED_TO_PRINTIFY',
      });
      expect(result.unresolvedFulfillmentGroupIds).toContain(second);
      const after = await snapshot(f.orderId);
      expect(after.payments).toEqual(before.payments);
      expect(after.refunds).toEqual(before.refunds);
      expect(after.returns).toEqual(before.returns);
      expect(after.items).toEqual(before.items);
      expect(
        (await pool.query(`SELECT id FROM app.lifecycle_deliveries WHERE order_id=$1`, [f.orderId]))
          .rows,
      ).toEqual([]);
    },
  );

  it('binds cancellation keys to the requested order and action and rejects a second aggregate', async () => {
    const first = await fixture('UNFULFILLED', 'PAID', 'NOT_STARTED');
    const second = await fixture('UNFULFILLED', 'PAID', 'NOT_STARTED');
    const { actions } = cancellationService();
    const input = cancellationInput(first.orderNumber);
    const results = await Promise.allSettled([
      actions.cancel(staff, input),
      actions.cancel(staff, { ...input, orderNumber: second.orderNumber }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: expect.any(domain.OrderAdminActionConflictError) },
    ]);
    const winner = results[0]!.status === 'fulfilled' ? first : second;
    await expect(
      actions.cancel(staff, cancellationInput(winner.orderNumber)),
    ).rejects.toBeInstanceOf(domain.OrderAdminActionConflictError);
    await expect(
      actions.archive(staff, {
        orderNumber: winner.orderNumber,
        reasonCode: input.reasonCode,
        idempotencyKey: input.idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(domain.OrderAdminActionConflictError);
    expect((await cancellationRows(winner.orderId)).cancellations).toHaveLength(1);
  });

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

  async function waitForDatabaseLock(name = applicationName) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const waiting = await pool.query<{ pid: number; blockers: number[] }>(
        `SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
         WHERE application_name=$1 AND wait_event_type='Lock'`,
        [name],
      );
      if (waiting.rows[0]) return waiting.rows[0];
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Archive action did not wait on the held PostgreSQL row lock.');
  }

  // Order→group versus group→order must not deadlock real action and provider transactions.
  it.each(['archive', 'unarchive'] as const)(
    'commits concurrent %s and provider reconciliation without a lock-order deadlock',
    async (method) => {
      const f = await fixture('FULFILLED', 'SHIPPED');
      const actions = service();
      if (method === 'unarchive') await actions.archive(staff, f.input());
      const externalOrderId = `archive-reconcile-${randomUUID()}`;
      await pool.query(`UPDATE app.order_fulfillment_groups SET external_order_id=$2 WHERE id=$1`, [
        f.groupId,
        externalOrderId,
      ]);
      const before = await snapshot(f.orderId);
      const reconciliationName = `reconcile-test-${randomUUID()}`;
      const reconciliationUrl = new URL(integrationDatabaseUrl!);
      reconciliationUrl.searchParams.set('application_name', reconciliationName);
      const reconciliationDatabase = createDatabaseClient(reconciliationUrl.toString());
      const operations = new domain.OrderOperationsService(
        reconciliationDatabase.pool,
        new MemoryObjectStorage(),
        new ArchiveFixtureFulfillment(),
        { realProductionSubmissionEnabled: false, fulfillmentAdapter: 'fake' },
      );
      const gate = await pool.connect();
      const input = f.input();
      const gateKey = `order-admin-action:${input.idempotencyKey}`;
      const eventId = randomUUID();
      const trackingNumber = `TRACK-${randomUUID()}`;
      let archive: Promise<PromiseSettledResult<domain.ArchiveResult>[]> | undefined;
      let reconciliation: Promise<PromiseSettledResult<void>[]> | undefined;
      let gateHeld = false;
      try {
        // Hold only the action's idempotency lock, so it pauses after acquiring its real order lock.
        await gate.query('SELECT pg_advisory_lock(hashtext($1))', [gateKey]);
        gateHeld = true;
        archive = Promise.allSettled([actions[method](staff, input)]);
        const waitingAction = await waitForDatabaseLock();
        reconciliation = Promise.allSettled([
          operations.reconcileStatus({
            externalOrderId,
            rawStatus: 'delivered',
            source: 'WEBHOOK',
            externalEventId: eventId,
            tracking: { trackingNumber, carrier: 'Fixture Carrier' },
          }),
        ]);
        const waitingReconciliation = await waitForDatabaseLock(reconciliationName);
        expect(waitingReconciliation.blockers).toContain(waitingAction.pid);
        // Previously reconciliation held the group here; releasing this gate closes the deadlock cycle.
        await gate.query('SELECT pg_advisory_unlock(hashtext($1))', [gateKey]);
        gateHeld = false;
        const results = [...(await archive), ...(await reconciliation)];
        expect(
          results
            .filter((result) => result.status === 'rejected')
            .map((result) => ({
              code: (result.reason as { code?: string }).code,
              message: (result.reason as Error).message,
            })),
        ).toEqual([]);
        expect(results).toMatchObject([
          {
            status: 'fulfilled',
            value: { orderId: f.orderId, archived: method === 'archive', duplicate: false },
          },
          { status: 'fulfilled', value: undefined },
        ]);
      } finally {
        if (gateHeld) await gate.query('SELECT pg_advisory_unlock(hashtext($1))', [gateKey]);
        gate.release();
        await archive;
        await reconciliation;
        await reconciliationDatabase.close();
      }
      const after = await snapshot(f.orderId);
      expect(after.order).toMatchObject({
        status: 'DELIVERED',
        archived_at: method === 'archive' ? expect.any(Date) : null,
        archived_by_staff_member_id: method === 'archive' ? staff.staffMemberId : null,
      });
      expect(after.groups).toMatchObject([
        { printing_status: 'PRINTED', fulfillment_status: 'DELIVERED' },
      ]);
      expect(after.payments).toEqual(before.payments);
      expect(after.refunds).toEqual(before.refunds);
      expect(after.returns).toEqual(before.returns);
      expect(await audits(f.orderId)).toHaveLength(method === 'archive' ? 1 : 2);
      expect(
        (
          await pool.query(
            `SELECT status,tracking_number,carrier FROM app.order_shipments
        WHERE fulfillment_group_id=$1`,
            [f.groupId],
          )
        ).rows,
      ).toEqual([
        { status: 'DELIVERED', tracking_number: trackingNumber, carrier: 'Fixture Carrier' },
      ]);
      expect(
        (
          await pool.query(
            `SELECT normalized_status,disposition FROM app.order_fulfillment_status_events
        WHERE order_id=$1 AND external_event_id=$2`,
            [f.orderId, eventId],
          )
        ).rows,
      ).toEqual([{ normalized_status: 'DELIVERED', disposition: 'APPLIED' }]);
    },
  );

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
