import { randomUUID } from 'node:crypto';
import { createDatabaseClient, integrationTestDatabaseUrl, type SqlPool } from '@let-it-be/db';
import { MemoryObjectStorage } from '@let-it-be/storage';
import * as domain from '@let-it-be/domain';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { doubles, requestFor } from './route-test-support';
import { POST as refund } from '../refunds/route';
import { POST as createReturn } from '../returns/route';
import { POST as transitionReturn } from '../returns/[returnId]/transitions/route';

const databaseUrl = integrationTestDatabaseUrl({
  ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
  ...(process.env.TEST_DATABASE_URL ? { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL } : {}),
  ...(process.env.INTEGRATION_TEST_DATABASE
    ? { INTEGRATION_TEST_DATABASE: process.env.INTEGRATION_TEST_DATABASE }
    : {}),
});
const suite = databaseUrl ? describe : describe.skip;

class FixtureFulfillment extends domain.FakePrintifyFulfillmentAdapter {
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
suite('Order action API real domain failure recovery', () => {
  const database = createDatabaseClient(databaseUrl!);
  const pool: SqlPool = database.pool;
  afterAll(async () => {
    await database.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
  });
  async function fixture() {
    const staff = {
      id: randomUUID(),
      expiresAt: new Date('2099-01-01'),
      staffMemberId: randomUUID(),
      role: 'OPERATIONS' as const,
      email: `api-action-${randomUUID()}@example.test`,
    };
    await pool.query(
      "INSERT INTO app.staff_members(id,normalized_email,role,status) VALUES($1,$2,'OPERATIONS','ACTIVE')",
      [staff.staffMemberId, staff.email],
    );
    const guest = await new domain.IdentityService(pool).createGuestSession();
    const project = await new domain.ProjectService(pool).create(guest, {
      productModelId: 'essential-dtg-tee',
      colorCode: 'black',
    });
    const storage = new MemoryObjectStorage();
    const key = `api-actions/${randomUUID()}.svg`;
    const body = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><path d="M260 320h680v960H260z" fill="#f6b943"/></svg>',
    );
    const asset = (
      await pool.query<{ id: string }>(
        "INSERT INTO app.assets(project_id,asset_type,storage_key,content_type,byte_size,width,height) VALUES($1,'PREPRESS_PREVIEW',$2,'image/svg+xml',$3,1200,1600) RETURNING id",
        [project.id, key, body.byteLength],
      )
    ).rows[0]!;
    await storage.put({ key, body, contentType: 'image/svg+xml' });
    await pool.query(
      "INSERT INTO app.prepress_runs(project_id,project_version_id,production_profile_id,status,renderer_version,idempotency_key,preview_asset_id) VALUES($1,$2,'development-essential-dtg-front-v1','PASSED','fixture',$3,$4)",
      [project.id, project.activeVersionId, randomUUID(), asset.id],
    );
    const commerce = new domain.CommerceService(
      pool,
      new domain.FakePaymentService(),
      new domain.FakeTaxService(875),
      new FixtureFulfillment(),
      new domain.MockupService(pool, storage),
    );
    const cart = await commerce.createCart(guest, {
      projectId: project.id,
      size: 'M',
      quantity: 2,
    });
    await commerce.approveProof(guest, cart.id);
    const shippingAddressId = await commerce.saveShippingAddress(guest, cart.id, {
      recipientName: 'API Actions Fixture',
      email: `api-order-${randomUUID()}@example.test`,
      line1: '100 Main Street',
      city: 'San Francisco',
      stateCode: 'CA',
      postalCode: '94107',
      countryCode: 'US',
    });
    const checkout = await commerce.startCheckout(guest, cart.id, {
      shippingAddressId,
      billingAddress: null,
      idempotencyKey: randomUUID(),
    });
    const orderNumber = (await commerce.simulateFakePayment(guest, checkout.id, 'SUCCEEDED'))
      .orderNumber!;
    const orderId = (
      await pool.query<{ id: string }>('SELECT id FROM app.orders WHERE order_number=$1', [
        orderNumber,
      ])
    ).rows[0]!.id;
    const itemId = (
      await pool.query<{ id: string }>('SELECT id FROM app.order_items WHERE order_id=$1', [
        orderId,
      ])
    ).rows[0]!.id;
    await pool.query(
      "UPDATE app.order_fulfillment_groups SET fulfillment_status='DELIVERED',printing_status='PRINTED' WHERE order_id=$1",
      [orderId],
    );
    const detail = new domain.OrderDetailService(pool);
    const actions = new domain.OrderAdminActionsService(pool);
    doubles.requireAdminSession.mockResolvedValue(staff);
    doubles.orderAdminActionsRuntime.mockResolvedValue({ actions, detail });
    const context = {
      params: Promise.resolve({
        orderNumber: encodeURIComponent(orderNumber),
        returnId: randomUUID(),
      }),
    };
    return { staff, orderId, orderNumber, itemId, detail, actions, context };
  }
  it('returns current returnability after a real create-return quantity conflict', async () => {
    const f = await fixture();
    await f.actions.createReturn(f.staff, {
      orderNumber: f.orderNumber,
      items: [{ orderItemId: f.itemId, quantity: 2 }],
      reasonCode: 'DAMAGED',
      shippingRequired: false,
      idempotencyKey: randomUUID(),
    });
    const response = await createReturn(
      requestFor(
        {
          items: [{ orderItemId: f.itemId, quantity: 1 }],
          reasonCode: 'DAMAGED',
          shippingRequired: false,
        },
        'POST',
        randomUUID(),
      ),
      f.context,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'ORDER_ACTION_CONFLICT',
      eligibility: { actions: { return: false } },
      returnableItems: [{ orderItemId: f.itemId, returnableQuantity: 0 }],
    });
  });
  it('returns actual return states and balances after a real stale transition', async () => {
    const f = await fixture();
    const returned = await f.actions.createReturn(f.staff, {
      orderNumber: f.orderNumber,
      items: [{ orderItemId: f.itemId, quantity: 1 }],
      reasonCode: 'DAMAGED',
      shippingRequired: false,
      idempotencyKey: randomUUID(),
    });
    await f.actions.transitionReturn(f.staff, {
      orderNumber: f.orderNumber,
      returnId: returned.id,
      toState: 'APPROVED',
      idempotencyKey: randomUUID(),
    });
    const response = await transitionReturn(
      requestFor({ toState: 'APPROVED' }, 'POST', randomUUID()),
      {
        params: Promise.resolve({
          orderNumber: encodeURIComponent(f.orderNumber),
          returnId: returned.id,
        }),
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'ORDER_ACTION_CONFLICT',
      eligibility: { actions: { return: true } },
      returns: [{ id: returned.id, state: 'APPROVED' }],
      returnableItems: [{ orderItemId: f.itemId, returnableQuantity: 1 }],
    });
  });
  for (const failure of ['transport', 'finalization'] as const)
    it(
      'recovers first-attempt ' + failure + ' failure and never resends money movement',
      async () => {
        const f = await fixture();
        const payments = new domain.FakePaymentService();
        let paymentCalls = 0;
        vi.spyOn(payments, 'refund').mockImplementation(async () => {
          paymentCalls++;
          if (failure === 'transport') throw new TypeError('fetch failed: private-provider-data');
          return {
            providerRefundId: 'provider-private-refund',
            status: 'SUCCEEDED' as const,
            providerStatus: 'succeeded' as const,
          };
        });
        let failFinalization = failure === 'finalization';
        const faultPool: SqlPool = {
          query: (sql, values) => pool.query(sql, values),
          async connect() {
            const client = await pool.connect();
            return {
              release: () => client.release(),
              async query(sql, values) {
                if (
                  failFinalization &&
                  sql.includes('UPDATE app.order_refunds SET provider_refund_id')
                ) {
                  failFinalization = false;
                  throw new Error('private-finalization-error');
                }
                return client.query(sql, values);
              },
            };
          },
        };
        const refunds = new domain.OrderRefundService(faultPool, payments);
        doubles.orderAdminActionsRuntime.mockResolvedValue({
          actions: f.actions,
          detail: f.detail,
          refunds,
        });
        const idempotencyKey = randomUUID();
        const body = {
          destination: 'ORIGINAL_PAYMENT',
          amountCents: 1200,
          reasonCode: 'CUSTOMER_REQUEST',
        };
        const response = await refund(requestFor(body, 'POST', idempotencyKey), f.context);
        expect(response.status).toBe(202);
        const payload = await response.json();
        expect(payload).toMatchObject({
          result: {
            status: 'PENDING',
            amountCents: 1200,
            destination: 'ORIGINAL_PAYMENT',
          },
        });
        expect(JSON.stringify(payload)).not.toMatch(/private|providerRefundId/);
        const ledger = await pool.query<{ id: string; status: string }>(
          'SELECT id,status FROM app.order_refunds WHERE idempotency_key=$1',
          [idempotencyKey],
        );
        expect(ledger.rows).toHaveLength(1);
        expect(payload.result.refundId).toBe(ledger.rows[0]!.id);
        expect(
          await refunds.recoverRefundResult(
            { type: 'STAFF', ...f.staff },
            {
              orderNumber: '#999999999',
              idempotencyKey,
              amountCents: 1200,
              reasonCode: 'CUSTOMER_REQUEST',
            },
          ),
        ).toBeNull();
        const duplicate = await refund(requestFor(body, 'POST', idempotencyKey), f.context);
        expect(duplicate.status).toBe(response.status);
        expect(paymentCalls).toBe(1);
      },
    );
});
