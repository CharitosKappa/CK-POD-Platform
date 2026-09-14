import { randomUUID } from 'node:crypto';

import { createDatabaseClient, integrationTestDatabaseUrl } from '@let-it-be/db';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { afterAll, describe, expect, it } from 'vitest';

import { CustomerOperationsService, reconcileCustomerProfiles } from './customer-operations';
import {
  CommerceService,
  FakePaymentService,
  FakePrintifyFulfillmentAdapter,
  FakeTaxService,
  IdentityService,
  MockupService,
  ProjectService,
  type NormalizedShippingQuote,
} from './index';

class CustomerFinancialsFulfillment extends FakePrintifyFulfillmentAdapter {
  override async quoteShipping(): Promise<NormalizedShippingQuote> {
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

suite('customer profile reconciliation integration', () => {
  const database = createDatabaseClient(integrationDatabaseUrl!);
  const userId = randomUUID();
  const email = `reconcile-${randomUUID()}@example.test`;
  const staffMemberId = randomUUID();
  const customerOperations = new CustomerOperationsService(database.pool);
  const staff = {
    staffMemberId,
    role: 'OPERATIONS' as const,
    email: `customer-financials-${randomUUID()}@example.test`,
  };

  async function paidOrder(customerEmail: string) {
    const guest = await new IdentityService(database.pool).createGuestSession();
    const project = await new ProjectService(database.pool).create(guest, {
      productModelId: 'essential-dtg-tee',
      colorCode: 'black',
    });
    const storage = new MemoryObjectStorage();
    const key = `customer-financials/${randomUUID()}.svg`;
    const body = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><path d="M260 320h680v960H260z" fill="#f6b943"/></svg>',
    );
    const asset = (
      await database.pool.query<{ id: string }>(
        `INSERT INTO app.assets (project_id,asset_type,storage_key,content_type,byte_size,width,height)
         VALUES ($1,'PREPRESS_PREVIEW',$2,'image/svg+xml',$3,1200,1600) RETURNING id`,
        [project.id, key, body.byteLength],
      )
    ).rows[0]!;
    await storage.put({ key, body, contentType: 'image/svg+xml' });
    await database.pool.query(
      `INSERT INTO app.prepress_runs (project_id,project_version_id,production_profile_id,
       status,renderer_version,idempotency_key,preview_asset_id)
       VALUES ($1,$2,'development-essential-dtg-front-v1','PASSED','fixture',$3,$4)`,
      [project.id, project.activeVersionId, randomUUID(), asset.id],
    );
    const commerce = new CommerceService(
      database.pool,
      new FakePaymentService(),
      new FakeTaxService(),
      new CustomerFinancialsFulfillment(),
      new MockupService(database.pool, storage),
    );
    const cart = await commerce.createCart(guest, {
      projectId: project.id,
      size: 'M',
      quantity: 1,
    });
    await commerce.approveProof(guest, cart.id);
    const addressId = await commerce.saveShippingAddress(guest, cart.id, {
      recipientName: 'Financial Projection',
      email: customerEmail,
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
    return (
      await database.pool.query<{
        order_id: string;
        customer_profile_id: string;
        payment_id: string;
        provider_payment_id: string;
      }>(
        `SELECT orders.id AS order_id,orders.customer_profile_id,payment.id AS payment_id,
                payment.provider_payment_id
         FROM app.orders orders
         JOIN app.payments payment ON payment.checkout_attempt_id=orders.checkout_attempt_id
         WHERE orders.order_number=$1`,
        [paid.orderNumber],
      )
    ).rows[0]!;
  }

  async function expectFinancials(
    customerProfileId: string,
    customerEmail: string,
    expectedCents: number,
  ) {
    const listed = await customerOperations.listCustomers(staff, {
      query: customerEmail,
      limit: 10,
    });
    expect(listed.customers).toHaveLength(1);
    expect(listed.customers[0]).toMatchObject({
      id: customerProfileId,
      orderCount: 1,
      totalSpentCents: expectedCents,
    });
    const detail = await customerOperations.getCustomer(staff, customerProfileId);
    expect(detail).toMatchObject({
      orderCount: 1,
      totalSpentCents: expectedCents,
      averageOrderValueCents: expectedCents,
    });
  }

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

  it('projects customer spend from successful captures and actual refunds instead of edited totals', async () => {
    await database.pool.query(
      `INSERT INTO app.staff_members (id,normalized_email,role,status)
       VALUES ($1,$2,'OPERATIONS','ACTIVE')`,
      [staffMemberId, staff.email],
    );
    const decreasedEmail = `decreased-${randomUUID()}@example.test`;
    const decreased = await paidOrder(decreasedEmail);
    const decreasedRefundId = randomUUID();
    const decreasedRefundProviderId = `fake_refund_${randomUUID()}`;
    const decreasedRefundKey = `refund-${randomUUID()}`;
    await database.pool.query('UPDATE app.payments SET amount_cents=10000 WHERE id=$1', [
      decreased.payment_id,
    ]);
    await database.pool.query(
      `UPDATE app.orders
       SET pricing_snapshot=jsonb_set(pricing_snapshot,'{totalCents}','8000'::jsonb)
       WHERE id=$1`,
      [decreased.order_id],
    );
    await database.pool.query(
      `INSERT INTO app.order_refunds
       (id,order_id,payment_id,provider,provider_refund_id,idempotency_key,amount_cents,
        reason_code,status,initiated_by_staff_member_id,destination,completed_at)
       VALUES ($1,$2,$3,'FAKE',$4,$5,2000,'CUSTOMER_REQUEST','SUCCEEDED',$6,
               'ORIGINAL_PAYMENT',now())`,
      [
        decreasedRefundId,
        decreased.order_id,
        decreased.payment_id,
        decreasedRefundProviderId,
        decreasedRefundKey,
        staffMemberId,
      ],
    );
    await expectFinancials(decreased.customer_profile_id, decreasedEmail, 8000);
    await database.pool.query(
      `INSERT INTO app.order_refund_allocations
       (order_refund_id,order_id,checkout_payment_id,allocation_sequence,provider,
        provider_payment_id,amount_cents,currency,status,submission_state,provider_refund_id,
        idempotency_key,completed_at)
       VALUES ($1,$2,$3,1,'FAKE',$4,2000,'USD','SUCCEEDED','IDENTIFIED',$5,$6,now())`,
      [
        decreasedRefundId,
        decreased.order_id,
        decreased.payment_id,
        decreased.provider_payment_id,
        decreasedRefundProviderId,
        decreasedRefundKey,
      ],
    );
    await expectFinancials(decreased.customer_profile_id, decreasedEmail, 8000);

    const increasedEmail = `increased-${randomUUID()}@example.test`;
    const increased = await paidOrder(increasedEmail);
    await database.pool.query('UPDATE app.payments SET amount_cents=10000 WHERE id=$1', [
      increased.payment_id,
    ]);
    await database.pool.query(
      `UPDATE app.orders
       SET pricing_snapshot=jsonb_set(pricing_snapshot,'{totalCents}','12000'::jsonb)
       WHERE id=$1`,
      [increased.order_id],
    );
    await expectFinancials(increased.customer_profile_id, increasedEmail, 10000);

    const revisionId = randomUUID();
    const attemptId = randomUUID();
    const supplementalProviderPaymentId = `fake_pi_${randomUUID()}`;
    await database.pool.query(
      `INSERT INTO app.order_revisions
       (id,order_id,before_snapshot,after_snapshot,price_difference_cents,reason_code,
        created_by_staff_member_id,idempotency_key)
       VALUES ($1,$2,'{}','{}',2000,'CUSTOMER_REQUEST',$3,$4)`,
      [revisionId, increased.order_id, staffMemberId, `revision-${randomUUID()}`],
    );
    await database.pool.query(
      `INSERT INTO app.order_edit_payment_attempts
       (id,order_id,order_revision_id,status,amount_cents,currency,provider,
        provider_payment_id,provider_status,initiated_by_staff_member_id,idempotency_key,
        request_snapshot,provider_submission_started_at,completed_at)
       VALUES ($1,$2,$3,'SUCCEEDED',2000,'USD','FAKE',$4,'succeeded',$5,$6,'{}',now(),now())`,
      [
        attemptId,
        increased.order_id,
        revisionId,
        supplementalProviderPaymentId,
        staffMemberId,
        `payment-${randomUUID()}`,
      ],
    );
    await database.pool.query(
      `INSERT INTO app.order_payment_captures
       (order_id,order_edit_payment_attempt_id,provider,provider_payment_id,amount_cents,
        currency,request_snapshot)
       VALUES ($1,$2,'FAKE',$3,2000,'USD','{}')`,
      [increased.order_id, attemptId, supplementalProviderPaymentId],
    );
    await expectFinancials(increased.customer_profile_id, increasedEmail, 12000);
  });
});
