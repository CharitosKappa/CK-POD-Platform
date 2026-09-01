import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import { MemoryObjectStorage } from '@let-it-be/storage';

import { IdentityService } from './identity.js';
import { LifecycleOrchestrator } from './operations-analytics.js';
import { PrivacyLifecycleService } from './privacy-lifecycle.js';
import { ProjectService } from './projects.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;
const integrationSuite = integrationDatabaseUrl ? describe : describe.skip;

integrationSuite('privacy technical lifecycle integration', () => {
  let pool: SqlPool;
  let close: () => Promise<void>;
  let identity: IdentityService;
  let projects: ProjectService;
  let privacy: PrivacyLifecycleService;

  beforeAll(() => {
    const database = createDatabaseClient(integrationDatabaseUrl as string);
    pool = database.pool;
    close = database.close;
    identity = new IdentityService(pool);
    projects = new ProjectService(pool);
    privacy = new PrivacyLifecycleService(pool);
  });

  afterAll(async () => close());

  it('identifies and deletes only expired unfinished work and its private assets', async () => {
    const account = await identity.register(
      await identity.createGuestSession(),
      uniqueEmail(),
      'privacy-lifecycle-test-password',
    );
    const project = await projects.create(account, {
      productModelId: 'essential-dtg-tee',
      colorCode: 'black',
    });
    const storage = new MemoryObjectStorage();
    const storageKey = `privacy/${randomBytes(6).toString('hex')}.png`;
    await storage.put({ key: storageKey, body: new Uint8Array([1]), contentType: 'image/png' });
    const asset = await pool.query<{ id: string }>(
      `INSERT INTO app.assets (project_id, asset_type, storage_key, content_type, byte_size)
       VALUES ($1, 'REFERENCE', $2, 'image/png', 1) RETURNING id`,
      [project.id, storageKey],
    );
    await pool.query(
      `UPDATE app.projects SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [project.id],
    );

    const report = await privacy.inspectUser(account.userId as string);
    expect(report.inventory.unfinishedProjects).toBe('ELIGIBLE_FOR_DELETION');
    expect(report.eligibleUnfinishedProjectIds).toContain(project.id);
    expect(report.eligiblePrivateAssetIds).toContain(asset.rows[0]?.id);

    const deleted = await privacy.deleteEligibleUnfinishedProjects(
      account.userId as string,
      storage,
    );
    expect(deleted).toMatchObject({ status: 'COMPLETED', action: 'UNFINISHED_PROJECT_DELETED' });
    expect(await storage.exists(storageKey)).toBe(false);
    expect(
      (await pool.query(`SELECT id FROM app.projects WHERE id = $1`, [project.id])).rows,
    ).toEqual([]);
  });

  it('anonymizes account data without deleting protected order and financial records', async () => {
    const email = uniqueEmail();
    const account = await identity.register(
      await identity.createGuestSession(),
      email,
      'privacy-anonymization-password',
    );
    const userId = account.userId as string;
    const fixture = await protectedFinancialFixture(pool, userId, email);

    const result = await privacy.anonymizeAccount(userId);
    expect(result.status).toBe('COMPLETED');
    expect(await identity.getSession(account.token)).toBeNull();
    const user = await pool.query<{ email: string }>(`SELECT email FROM app.users WHERE id = $1`, [
      userId,
    ]);
    expect(user.rows[0]?.email).toBe(`deleted+${userId}@redacted.invalid`);
    expect(
      (await pool.query(`SELECT id FROM app.orders WHERE id = $1`, [fixture.orderId])).rows,
    ).toHaveLength(1);
    expect(
      (await pool.query(`SELECT id FROM app.payments WHERE id = $1`, [fixture.paymentId])).rows,
    ).toHaveLength(1);
    const controls = await pool.query<{ marketing_suppressed_at: Date; anonymized_at: Date }>(
      `SELECT marketing_suppressed_at, anonymized_at FROM app.privacy_subject_controls WHERE user_id = $1`,
      [userId],
    );
    expect(controls.rows[0]?.marketing_suppressed_at).toBeInstanceOf(Date);
    expect(controls.rows[0]?.anonymized_at).toBeInstanceOf(Date);
  });

  it('keeps marketing suppressed while transactional messages remain independently deliverable', async () => {
    const email = uniqueEmail();
    const account = await identity.register(
      await identity.createGuestSession(),
      email,
      'privacy-marketing-suppression-password',
    );
    const send = vi.fn().mockResolvedValue({ providerMessageId: 'fake-privacy-message' });
    const lifecycle = new LifecycleOrchestrator(pool, { send }, 'FAKE');
    await privacy.suppressMarketing(account.userId as string);
    await lifecycle.trigger({
      type: 'SAVED_PROJECT',
      classification: 'MARKETING',
      recipientEmail: email,
      idempotencyKey: `privacy-marketing-${randomBytes(4).toString('hex')}`,
      payload: {},
    });
    await lifecycle.trigger({
      type: 'ORDER_CONFIRMATION',
      classification: 'TRANSACTIONAL',
      recipientEmail: email,
      idempotencyKey: `privacy-transactional-${randomBytes(4).toString('hex')}`,
      payload: { orderNumber: 'LIB-privacy' },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ classification: 'TRANSACTIONAL' });
  });

  it('blocks destructive account anonymization while a retention hold applies', async () => {
    const account = await identity.register(
      await identity.createGuestSession(),
      uniqueEmail(),
      'privacy-retention-hold-password',
    );
    await privacy.setRetentionHold(account.userId as string, 'LEGAL_HOLD');
    const result = await privacy.anonymizeAccount(account.userId as string);
    expect(result).toMatchObject({ status: 'BLOCKED', details: { reason: 'retention-hold' } });
  });
});

async function protectedFinancialFixture(pool: SqlPool, userId: string, email: string) {
  const cart = await pool.query<{ id: string }>(
    `INSERT INTO app.carts (owner_type, owner_user_id, status) VALUES ('USER', $1, 'COMPLETED') RETURNING id`,
    [userId],
  );
  const address = await pool.query<{ id: string }>(
    `INSERT INTO app.shipping_addresses (cart_id, recipient_name, email, line1, city, state_code, postal_code)
     VALUES ($1, 'Privacy Fixture', $2, '1 Test Way', 'Athens', 'AT', '10558') RETURNING id`,
    [cart.rows[0]?.id, email],
  );
  const checkout = await pool.query<{ id: string }>(
    `INSERT INTO app.checkout_attempts (cart_id, shipping_address_id, status, idempotency_key, amount_cents,
      pricing_snapshot, shipping_snapshot, tax_snapshot, payment_provider, price_expires_at)
     VALUES ($1, $2, 'PAID', $3, 100, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'FAKE', now() + interval '1 hour')
     RETURNING id`,
    [cart.rows[0]?.id, address.rows[0]?.id, `privacy-checkout-${randomBytes(6).toString('hex')}`],
  );
  const payment = await pool.query<{ id: string }>(
    `INSERT INTO app.payments (checkout_attempt_id, provider, provider_payment_id, status, amount_cents, currency)
     VALUES ($1, 'FAKE', $2, 'SUCCEEDED', 100, 'USD') RETURNING id`,
    [checkout.rows[0]?.id, `privacy-payment-${randomBytes(6).toString('hex')}`],
  );
  const order = await pool.query<{ id: string }>(
    `INSERT INTO app.orders (order_number, cart_id, checkout_attempt_id, owner_type, owner_user_id, customer_email,
      shipping_address_snapshot, pricing_snapshot, financial_snapshot, status)
     VALUES ($1, $2, $3, 'USER', $4, $5, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'PAID') RETURNING id`,
    [
      `LIB-PRIVACY-${randomBytes(5).toString('hex')}`,
      cart.rows[0]?.id,
      checkout.rows[0]?.id,
      userId,
      email,
    ],
  );
  return { orderId: order.rows[0]?.id as string, paymentId: payment.rows[0]?.id as string };
}

function uniqueEmail(): string {
  return `privacy-${randomBytes(8).toString('hex')}@example.test`;
}
