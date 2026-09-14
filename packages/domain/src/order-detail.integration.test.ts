import { createDatabaseClient, integrationTestDatabaseUrl } from '@let-it-be/db';
import { randomUUID } from 'node:crypto';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as domain from './index';
import { OrderDetailService } from './order-detail';

class DetailFixtureFulfillment extends domain.FakePrintifyFulfillmentAdapter {
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

suite('order detail persistence integration', () => {
  const database = createDatabaseClient(integrationDatabaseUrl!);
  const pool = database.pool;
  const staff = {
    id: randomUUID(),
    staffMemberId: randomUUID(),
    role: 'OPERATIONS' as const,
    email: `detail-${randomUUID()}@example.test`,
    expiresAt: new Date('2099-01-01'),
  };
  beforeAll(async () => {
    await pool.query(
      "INSERT INTO app.staff_members (id,normalized_email,role,status) VALUES ($1,$2,'OPERATIONS','ACTIVE')",
      [staff.staffMemberId, staff.email],
    );
  });
  async function fixture() {
    const guest = await new domain.IdentityService(pool).createGuestSession();
    const project = await new domain.ProjectService(pool).create(guest, {
      productModelId: 'essential-dtg-tee',
      colorCode: 'black',
    });
    const storage = new MemoryObjectStorage();
    const key = `detail/${randomUUID()}.svg`;
    const body = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><path d="M260 320h680v960H260z" fill="#f6b943"/></svg>',
    );
    const asset = (
      await pool.query<{ id: string }>(
        `INSERT INTO app.assets (project_id,asset_type,storage_key,content_type,byte_size,width,height) VALUES ($1,'PREPRESS_PREVIEW',$2,'image/svg+xml',$3,1200,1600) RETURNING id`,
        [project.id, key, body.byteLength],
      )
    ).rows[0]!;
    await storage.put({ key, body, contentType: 'image/svg+xml' });
    await pool.query(
      `INSERT INTO app.prepress_runs (project_id,project_version_id,production_profile_id,status,renderer_version,idempotency_key,preview_asset_id) VALUES ($1,$2,'development-essential-dtg-front-v1','PASSED','fixture',$3,$4)`,
      [project.id, project.activeVersionId, randomUUID(), asset.id],
    );
    const commerce = new domain.CommerceService(
      pool,
      new domain.FakePaymentService(),
      new domain.FakeTaxService(875),
      new DetailFixtureFulfillment(),
      new domain.MockupService(pool, storage),
    );
    const cart = await commerce.createCart(guest, {
      projectId: project.id,
      size: 'M',
      quantity: 2,
    });
    await commerce.approveProof(guest, cart.id);
    const addressId = await commerce.saveShippingAddress(guest, cart.id, {
      recipientName: 'Detail Fixture',
      email: `detail-order-${randomUUID()}@example.test`,
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
    const order = (
      await pool.query<{ id: string; payment_id: string; total: number }>(
        `SELECT o.id,p.id AS payment_id,p.amount_cents AS total FROM app.orders o JOIN app.payments p ON p.checkout_attempt_id=o.checkout_attempt_id WHERE o.order_number=$1`,
        [paid.orderNumber],
      )
    ).rows[0]!;
    const item = (
      await pool.query<{ id: string }>('SELECT id FROM app.order_items WHERE order_id=$1', [
        order.id,
      ])
    ).rows[0]!;
    return { ...order, orderNumber: paid.orderNumber!, itemId: item.id };
  }

  it('provides persisted variant identifiers and only active same-product options for safe editing', async () => {
    const order = await fixture();
    const detail = await new OrderDetailService(pool).getOrder(staff, order.orderNumber);
    const item = detail!.groups
      .flatMap((group) => group.items)
      .find((row) => row.id === order.itemId)!;
    expect(item.productVariantId).toBe('essential-dtg-tee-black-M');
    expect(item.variantOptions).toContainEqual({
      id: 'essential-dtg-tee-black-M',
      color: 'Black',
      size: 'M',
    });
    const available = await pool.query<{ id: string }>(
      "SELECT id FROM app.product_variants WHERE product_model_id='essential-dtg-tee' AND status='ACTIVE'",
    );
    expect(item.variantOptions.map((variant) => variant.id).sort()).toEqual(
      available.rows.map((variant) => variant.id).sort(),
    );
  });

  it('projects the immutable edited unit price instead of stale snapshot or mutable catalog prices', async () => {
    const order = await fixture();
    await pool.query(
      `UPDATE app.order_items
       SET item_snapshot=item_snapshot || '{"unitPriceCents":4321}'::jsonb
       WHERE id=$1`,
      [order.itemId],
    );
    await pool.query(
      `UPDATE app.product_variants SET price_cents=9999
       WHERE id=(SELECT product_variant_id FROM app.order_items WHERE id=$1)`,
      [order.itemId],
    );

    const service = new OrderDetailService(pool);
    const detail = await service.getOrder(staff, order.orderNumber);
    const item = detail!.groups
      .flatMap((group) => group.items)
      .find((row) => row.id === order.itemId);
    expect(item).toMatchObject({ unitPriceCents: 4321, lineTotalCents: 8642 });

    const group = await service.getPrintingGroup(staff, order.orderNumber, detail!.groups[0]!.id);
    expect(group?.items.find((row) => row.id === order.itemId)).toMatchObject({
      unitPriceCents: 4321,
      lineTotalCents: 8642,
    });
  });

  it('projects persisted action balances, archive actor, returns and current revision tax', async () => {
    const order = await fixture();
    await pool.query(
      `UPDATE app.orders SET archived_at='2026-09-14T12:00:00Z',archived_by_staff_member_id=$2,amount_due_cents=0,refundable_adjustment_cents=200,
      financial_snapshot=jsonb_set(financial_snapshot,'{taxSnapshot}','{"taxCents":200,"taxableSubtotalCents":5000,"shippingTaxCents":0}'),
      pricing_snapshot=jsonb_set(pricing_snapshot,'{taxCents}','200'),shipping_address_snapshot=jsonb_set(shipping_address_snapshot,'{stateCode}','"WY"') WHERE id=$1`,
      [order.id, staff.staffMemberId],
    );
    await pool.query(
      "UPDATE app.order_fulfillment_groups SET printing_status='PRINTED',fulfillment_status='DELIVERED' WHERE order_id=$1",
      [order.id],
    );
    for (const [status, amount] of [
      ['SUCCEEDED', 1000],
      ['PENDING', 500],
      ['FAILED', 700],
    ] as const)
      await pool.query(
        `INSERT INTO app.order_refunds (order_id,payment_id,provider,idempotency_key,amount_cents,status,reason_code,initiated_by_staff_member_id) VALUES ($1,$2,'FAKE',$3,$4,$5,'TEST',$6)`,
        [order.id, order.payment_id, randomUUID(), amount, status, staff.staffMemberId],
      );
    const providerRefundId = `provider-secret-${randomUUID()}`;
    const pendingRefundId = (
      await pool.query<{ id: string }>(
        `UPDATE app.order_refunds SET provider_refund_id=$2
         WHERE order_id=$1 AND status='PENDING' RETURNING id`,
        [order.id, providerRefundId],
      )
    ).rows[0]!.id;
    const actions = new domain.OrderAdminActionsService(pool);
    const returned = await actions.createReturn(staff, {
      orderNumber: order.orderNumber,
      idempotencyKey: randomUUID(),
      reasonCode: 'FIT',
      shippingRequired: true,
      items: [{ orderItemId: order.itemId, quantity: 1 }],
    });
    const detail = await new OrderDetailService(pool).getOrder(staff, order.orderNumber);
    expect(detail).toMatchObject({
      archived: true,
      archivedAt: new Date('2026-09-14T12:00:00Z'),
      archivedByStaffMemberId: staff.staffMemberId,
      archivedByName: staff.email,
      amountDueCents: 0,
      refundableAdjustmentCents: 200,
      refundableCents: order.total - 1500,
      pendingRefunds: [
        {
          id: pendingRefundId,
          destination: 'ORIGINAL_PAYMENT',
          amountCents: 500,
          status: 'PENDING',
          createdAt: expect.any(Date),
        },
      ],
      returnableItems: [
        {
          orderItemId: order.itemId,
          fulfilledQuantity: 2,
          returnedQuantity: 1,
          returnableQuantity: 1,
        },
      ],
      returns: [{ id: returned.id, state: 'REQUESTED' }],
      eligibility: {
        actions: { cancel: false, return: true, unarchive: true },
        editFields: { items: false },
      },
    });
    expect(JSON.stringify(detail?.pendingRefunds)).not.toMatch(
      new RegExp(`${providerRefundId}|providerRefundId|paymentId|idempotency`, 'i'),
    );
    expect(detail?.financials.taxLines).toEqual([
      { label: 'Wyoming Sales Tax', rateBasisPoints: 400, amountCents: 200 },
    ]);
    const readOnly = await new OrderDetailService(pool).getOrder(
      { ...staff, role: 'READ_ONLY' },
      order.orderNumber,
    );
    expect(Object.values(readOnly!.eligibility.actions)).toEqual(Array(6).fill(false));
    await actions.transitionReturn(staff, {
      orderNumber: order.orderNumber,
      returnId: returned.id,
      toState: 'REJECTED',
      idempotencyKey: randomUUID(),
    });
    const rejected = await new OrderDetailService(pool).getOrder(staff, order.orderNumber);
    expect(rejected?.returnableItems[0]).toMatchObject({
      returnedQuantity: 0,
      returnableQuantity: 2,
    });
    expect(rejected?.returns[0]?.state).toBe('REJECTED');
  });

  it.each(['PARTIALLY_FULFILLED', 'CANCELLED_HISTORY_WITH_DELIVERED_REPLACEMENT'])(
    'matches mutation eligibility for authoritative groups: %s',
    async (scenario) => {
      const order = await fixture();
      await pool.query(
        `UPDATE app.order_fulfillment_groups SET printing_status='READY_FOR_PRODUCTION',fulfillment_status=$2 WHERE order_id=$1`,
        [order.id, scenario === 'PARTIALLY_FULFILLED' ? 'PARTIALLY_FULFILLED' : 'DELIVERED'],
      );
      if (scenario === 'CANCELLED_HISTORY_WITH_DELIVERED_REPLACEMENT') {
        await pool.query(
          `INSERT INTO app.order_fulfillment_groups (order_id,group_key,adapter_type,provider_id,qualification_id,shipping_snapshot,status,printing_status,fulfillment_status)
          SELECT order_id,'historical-cancelled',adapter_type,provider_id,qualification_id,shipping_snapshot,'CANCELLED','CANCELLED','CANCELLED'
          FROM app.order_fulfillment_groups WHERE order_id=$1`,
          [order.id],
        );
      }
      const detail = await new OrderDetailService(pool).getOrder(staff, order.orderNumber);
      let mutationEligibility: unknown;
      try {
        await new domain.OrderAdminActionsService(pool).archive(staff, {
          orderNumber: order.orderNumber,
          reasonCode: 'COMPLETE',
          idempotencyKey: randomUUID(),
        });
        expect.fail('Archive must reject these persisted fulfillment states.');
      } catch (error) {
        expect(error).toBeInstanceOf(domain.OrderAdminActionConflictError);
        mutationEligibility = (error as domain.OrderAdminActionConflictError).eligibility;
      }
      expect(detail?.eligibility).toEqual(mutationEligibility);
      expect(detail?.fulfillmentState).toBe('PARTIALLY_FULFILLED');
      expect(detail?.eligibility.actions).toMatchObject({ cancel: false, archive: false });
      // The historical empty group stays omitted from item presentation only.
      expect(detail?.groups).toHaveLength(1);
    },
  );

  it('paginates more than ten equal-timestamp events by stable ID without gaps or duplicates', async () => {
    const order = await fixture();
    const ids = Array.from({ length: 23 }, () => randomUUID()).sort();
    await pool.query(
      `INSERT INTO app.order_operational_audits (id,order_id,action,actor_type,actor_staff_member_id,created_at)
      SELECT id,$1,'order_archived','OPS',$2,'2090-01-01T12:00:00Z' FROM unnest($3::uuid[]) id`,
      [order.id, staff.staffMemberId, ids],
    );
    const service = new OrderDetailService(pool);
    const first = await service.listTimeline(staff, order.orderNumber);
    const second = await service.listTimeline(staff, order.orderNumber, { page: 2 });
    const third = await service.listTimeline(staff, order.orderNumber, { page: 3 });
    const observed = [...first.events, ...second.events, ...third.events].filter(
      (event) => event.occurredAt.toISOString() === '2090-01-01T12:00:00.000Z',
    );
    expect(first.events).toHaveLength(10);
    expect(second.events).toHaveLength(10);
    expect(observed.map((event) => event.id)).toEqual(ids.reverse().map((id) => `audit:${id}`));
    expect(new Set(observed.map((event) => event.id)).size).toBe(23);
    expect((await service.listTimeline(staff, order.orderNumber, { page: 2 })).events).toEqual(
      second.events,
    );
  });

  it('projects cancellation uncertainty and edit interlocks without declaring partial cancellation terminal', async () => {
    const order = await fixture();
    const cancellation = (
      await pool.query<{ id: string }>(
        `INSERT INTO app.order_cancellations (order_id,status,refund_destination,reason_code,initiated_by_staff_member_id,idempotency_key,failure_reason) VALUES ($1,'PARTIAL','LATER','CUSTOMER_REQUEST',$2,$3,'Provider unavailable') RETURNING id`,
        [order.id, staff.staffMemberId, randomUUID()],
      )
    ).rows[0]!;
    await pool.query(
      `INSERT INTO app.order_cancellation_groups (order_cancellation_id,fulfillment_group_id,status,attempt_count,provider_error_code) SELECT $2,id,'REQUESTED',1,'AMBIGUOUS' FROM app.order_fulfillment_groups WHERE order_id=$1`,
      [order.id, cancellation.id],
    );
    const detail = await new OrderDetailService(pool).getOrder(staff, order.orderNumber);
    expect(detail).toMatchObject({
      cancellation: {
        id: cancellation.id,
        status: 'PARTIAL',
        failureReason: 'Provider unavailable',
        groups: [{ status: 'REQUESTED', attemptCount: 1, providerErrorCode: 'AMBIGUOUS' }],
      },
      eligibility: {
        actions: { archive: false },
        editFields: { items: false, pricing: false, shippingAddress: false },
      },
    });
  });

  it.each(['REQUESTED', 'PROCESSING', 'PARTIAL', 'FAILED'])(
    'offers persisted %s cancellation recovery after production evidence blocks a new cancellation',
    async (status) => {
      const order = await fixture();
      const cancellation = (
        await pool.query<{ id: string }>(
          `INSERT INTO app.order_cancellations (order_id,status,refund_destination,reason_code,initiated_by_staff_member_id,idempotency_key) VALUES ($1,$4,'LATER','CUSTOMER_REQUEST',$2,$3) RETURNING id`,
          [order.id, staff.staffMemberId, randomUUID(), status],
        )
      ).rows[0]!;
      await pool.query(
        "UPDATE app.order_fulfillment_groups SET printing_status='IN_PRODUCTION' WHERE order_id=$1",
        [order.id],
      );
      const service = new OrderDetailService(pool);
      const detail = await service.getOrder(staff, order.orderNumber);
      expect(detail!.eligibility.actions.cancel).toBe(false);
      expect(detail!.actionRecovery).toEqual({
        canResume: true,
        cancellation: { cancellationId: cancellation.id, status },
      });
      const readonly = await service.getOrder({ ...staff, role: 'READ_ONLY' }, order.orderNumber);
      expect(readonly!.actionRecovery).toEqual({ canResume: false, cancellation: null });
    },
  );

  it('includes action history with actors/details, stable ten-entry pagination and totals beyond the last page', async () => {
    const order = await fixture();
    const returned = (
      await pool.query<{ id: string }>(
        `INSERT INTO app.order_returns (order_id,state,reason_code,shipping_required,created_by_staff_member_id,idempotency_key) VALUES ($1,'APPROVED','FIT',true,$2,$3) RETURNING id`,
        [order.id, staff.staffMemberId, randomUUID()],
      )
    ).rows[0]!;
    await pool.query(
      `INSERT INTO app.order_return_items (order_return_id,order_item_id,quantity) VALUES ($1,$2,1)`,
      [returned.id, order.itemId],
    );
    for (const state of ['REQUESTED', 'APPROVED'])
      await pool.query(
        `INSERT INTO app.order_return_events (order_return_id,from_state,to_state,actor_staff_member_id,idempotency_key,note) VALUES ($1,$2,$3,$4,$5,'Customer fit request')`,
        [
          returned.id,
          state === 'REQUESTED' ? null : 'REQUESTED',
          state,
          staff.staffMemberId,
          randomUUID(),
        ],
      );
    await pool.query(
      `INSERT INTO app.order_revisions (order_id,before_snapshot,after_snapshot,price_difference_cents,reason_code,created_by_staff_member_id,idempotency_key) VALUES ($1,'{"order":{"customer_email":"before@example.test"}}','{"order":{"customer_email":"after@example.test"}}',-200,'CORRECTION',$2,$3)`,
      [order.id, staff.staffMemberId, randomUUID()],
    );
    await pool.query(
      `INSERT INTO app.order_cancellations (order_id,status,refund_destination,reason_code,initiated_by_staff_member_id,idempotency_key) VALUES ($1,'FAILED','LATER','CUSTOMER_REQUEST',$2,$3)`,
      [order.id, staff.staffMemberId, randomUUID()],
    );
    for (const action of [
      'order_archived',
      'order_unarchived',
      'order_cancellation_group_result',
      'refund_requested',
      'refund_succeeded',
    ])
      await pool.query(
        `INSERT INTO app.order_operational_audits (order_id,action,actor_type,actor_staff_member_id,reason_code,metadata) VALUES ($1,$2,'OPS',$3,'REVIEW','{"status":"FAILED","fulfillmentGroupId":"group-fixture","destination":"ORIGINAL_PAYMENT","amountCents":200}')`,
        [order.id, action, staff.staffMemberId],
      );
    await pool.query(
      `INSERT INTO app.lifecycle_deliveries (order_id,message_type,channel,classification,recipient_email,idempotency_key,provider,status,payload) VALUES ($1,'ORDER_CANCELLATION','EMAIL','TRANSACTIONAL','detail@example.test',$2,'FAKE','FAILED','{"preferredLocale":"en"}')`,
      [order.id, randomUUID()],
    );
    const service = new OrderDetailService(pool);
    const first = await service.listTimeline(staff, order.orderNumber);
    expect(first.limit).toBe(10);
    const all = [...first.events];
    for (let page = 2; all.length < first.total; page++)
      all.push(...(await service.listTimeline(staff, order.orderNumber, { page })).events);
    expect(new Set(all.map((event) => event.id)).size).toBe(first.total);
    expect(all).toEqual(
      [...all].sort(
        (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id),
      ),
    );
    expect(all).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ORDER_EDITED',
          actorName: staff.email,
          details: expect.objectContaining({
            priceDifferenceCents: -200,
            reasonCode: 'CORRECTION',
          }),
        }),
        expect.objectContaining({
          type: 'RETURN_REQUESTED',
          actorName: staff.email,
          details: expect.objectContaining({ quantity: 1 }),
        }),
        expect.objectContaining({ type: 'RETURN_APPROVED' }),
        expect.objectContaining({ type: 'ORDER_ARCHIVED' }),
        expect.objectContaining({ type: 'ORDER_UNARCHIVED' }),
        expect.objectContaining({
          type: 'PROVIDER_CANCELLATION_RESULT',
          details: expect.objectContaining({
            status: 'FAILED',
            fulfillmentGroupId: 'group-fixture',
          }),
        }),
        expect.objectContaining({ type: 'CANCELLATION_FAILED' }),
        expect.objectContaining({
          type: 'REFUND_REQUESTED',
          details: expect.objectContaining({ amountCents: 200, destination: 'ORIGINAL_PAYMENT' }),
        }),
        expect.objectContaining({
          type: 'MESSAGE_QUEUED',
          details: expect.objectContaining({ notificationLanguage: 'en' }),
        }),
        expect.objectContaining({ type: 'MESSAGE_FAILED' }),
      ]),
    );
    expect((await service.listTimeline(staff, order.orderNumber, { page: 999 })).total).toBe(
      first.total,
    );
  });

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
