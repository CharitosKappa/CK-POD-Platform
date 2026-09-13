import { randomBytes, randomUUID } from 'node:crypto';

import {
  createDatabaseClient,
  integrationTestDatabaseUrl,
  withTransaction,
  type SqlPool,
} from '@let-it-be/db';
import { integrityViolationCounts } from '@let-it-be/db/integrity';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AssetService } from './assets.js';
import { CommerceAccessError, CommerceService, CommerceValidationError } from './commerce.js';
import { IdentityService } from './identity.js';
import { FakePaymentService, FakeTaxService, StripePaymentService } from './payments.js';
import * as domain from './index.js';
import * as storeCredit from './store-credit.js';
import { ProjectService } from './projects.js';
import { MockupService } from './mockups.js';
import { CxOperationsService } from './operations-analytics.js';
import {
  OrderOperationsAccessError,
  OrderOperationsService,
  OrderTransitionError,
} from './order-operations.js';
import { FakePrintifyFulfillmentAdapter } from './printify.js';
import { OrderDetailService } from './order-detail.js';
import { FulfillmentIntegrationError } from './fulfillment-contracts.js';
import type { PaymentService } from './commerce-contracts.js';
import type {
  FulfillmentService,
  NormalizedShippingQuote,
  ShippingQuoteRequest,
} from './fulfillment-contracts.js';

const integrationDatabaseUrl = integrationTestDatabaseUrl(process.env);
const integrationSuite = integrationDatabaseUrl ? describe : describe.skip;

integrationSuite('mockup, cart, checkout, and paid-order integration', () => {
  let pool: SqlPool;
  let close: () => Promise<void>;
  let identity: IdentityService;
  let projects: ProjectService;
  let fulfillment: NoProductionFulfillment;
  let commerce: CommerceService;
  let storage: MemoryObjectStorage;

  beforeAll(() => {
    const database = createDatabaseClient(integrationDatabaseUrl as string);
    pool = database.pool;
    close = database.close;
    identity = new IdentityService(pool);
    projects = new ProjectService(pool);
    fulfillment = new NoProductionFulfillment();
    storage = new MemoryObjectStorage();
    commerce = new CommerceService(
      pool,
      new FakePaymentService(),
      new FakeTaxService(875),
      fulfillment,
      new MockupService(pool, storage),
    );
  });

  afterAll(async () => close());

  it('creates an owned cart from a passed canonical project, persists variant/quantity, and produces a controlled proof', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 3,
    });
    expect(cart.item).toMatchObject({
      projectId: ready.projectId,
      size: 'M',
      quantity: 3,
      colorCode: 'black',
      designPreviewAssetId: ready.previewAssetId,
    });
    expect(cart.proofApproved).toBe(false);
    await expect(
      commerce.getCart(await identity.createGuestSession(), cart.id),
    ).rejects.toBeInstanceOf(CommerceAccessError);
    const mockup = await pool.query<{
      preview_asset_id: string;
      garment_profile_id: string;
      garment_profile_version: string;
      renderer: string;
      renderer_version: string;
    }>(
      `SELECT preview_asset_id, garment_profile_id, garment_profile_version, renderer, renderer_version
       FROM app.mockups WHERE id = $1`,
      [cart.item?.mockupId],
    );
    expect(mockup.rows[0]).toMatchObject({
      garment_profile_id: 'development-essential-tee-black-front-v1',
      garment_profile_version: 'v1',
      renderer: 'SHARP_GARMENT_PROFILE',
      renderer_version: 'sharp-garment-profile-v1',
    });
    expect(mockup.rows[0]?.preview_asset_id).not.toBe(ready.previewAssetId);
    const asset = await pool.query<{ asset_type: string; storage_key: string }>(
      `SELECT asset_type, storage_key FROM app.assets WHERE id = $1`,
      [mockup.rows[0]?.preview_asset_id],
    );
    expect(asset.rows[0]?.asset_type).toBe('MOCKUP_PROOF');
    expect(asset.rows[0]?.storage_key).toMatch(/^mockups\//);
    expect(await storage.exists(asset.rows[0]?.storage_key as string)).toBe(true);
    const lineage = await pool.query<{ relationship: string }>(
      `SELECT relationship FROM app.asset_lineage WHERE derived_asset_id = $1`,
      [mockup.rows[0]?.preview_asset_id],
    );
    expect(lineage.rows[0]?.relationship).toBe('MOCKUP_ARTWORK_SOURCE');
    const assets = new AssetService(pool);
    expect(
      await assets.getControlledPreview(
        ready.guest,
        ready.projectId,
        mockup.rows[0]?.preview_asset_id as string,
      ),
    ).toMatchObject({ contentType: 'image/png' });
    expect(
      await assets.getControlledPreview(
        await identity.createGuestSession(),
        ready.projectId,
        mockup.rows[0]?.preview_asset_id as string,
      ),
    ).toBeNull();
    const privateAssets = await pool.query<{ id: string }>(
      `INSERT INTO app.assets (project_id, asset_type, storage_key, content_type, byte_size)
       VALUES ($1, 'PRODUCTION_MASTER', $2, 'image/png', 1),
              ($1, 'PROVIDER_DERIVATIVE', $3, 'image/png', 1)
       RETURNING id`,
      [
        ready.projectId,
        `private/${randomBytes(4).toString('hex')}`,
        `provider/${randomBytes(4).toString('hex')}`,
      ],
    );
    for (const privateAsset of privateAssets.rows) {
      expect(
        await assets.getControlledPreview(ready.guest, ready.projectId, privateAsset.id),
      ).toBeNull();
    }
    expect(JSON.stringify(cart)).not.toContain('storage_key');
  });

  it('persists cart quantity changes with revision protection and supports removing the item', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const created = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'XL',
      quantity: 1,
    });
    expect(created.item?.unitPriceCents).toBeGreaterThan(0);
    if (!created.item) throw new Error('Expected the cart item to be created.');
    const cartItemId = created.item.id;

    const updated = await commerce.updateCartQuantity(ready.guest, created.id, {
      itemId: cartItemId,
      expectedRevision: created.revision,
      quantity: 4,
    });
    expect(updated.revision).toBe(created.revision + 1);
    expect(updated.item?.quantity).toBe(4);
    await expect(
      commerce.updateCartQuantity(ready.guest, created.id, {
        itemId: cartItemId,
        expectedRevision: created.revision,
        quantity: 2,
      }),
    ).rejects.toBeInstanceOf(CommerceValidationError);

    const removed = await commerce.removeCartItem(ready.guest, created.id, {
      itemId: cartItemId,
      expectedRevision: updated.revision,
    });
    expect(removed).toMatchObject({ status: 'ABANDONED', item: null });
  });

  it('uses a product/color-specific profile and reuses the deterministic proof for the same immutable state', async () => {
    const ready = await readyProject(pool, identity, projects, storage, 'navy');
    const first = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    const repeated = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'L',
      quantity: 1,
    });
    expect(repeated.id).toBe(first.id);
    expect(repeated.items).toHaveLength(2);
    expect(first.item?.mockupId).toBe(repeated.items[1]?.mockupId);
    const profile = await pool.query<{ color_code: string; garment_profile_id: string }>(
      `SELECT color_code, garment_profile_id FROM app.mockups WHERE id = $1`,
      [first.item?.mockupId],
    );
    expect(profile.rows[0]).toEqual({
      color_code: 'navy',
      garment_profile_id: 'development-essential-tee-navy-front-v1',
    });
  });

  it('invalidates a proof when the project version changes', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    await commerce.approveProof(ready.guest, cart.id);
    expect((await commerce.getCart(ready.guest, cart.id)).proofApproved).toBe(true);
    await projects.selectProduct(
      ready.guest,
      ready.projectId,
      { productModelId: 'essential-dtg-tee', colorCode: 'navy' },
      ready.revision,
    );
    await expect(commerce.approveProof(ready.guest, cart.id)).rejects.toBeInstanceOf(
      CommerceValidationError,
    );
    expect((await commerce.getCart(ready.guest, cart.id)).proofApproved).toBe(false);
  });

  it('invalidates approval and regenerates a proof when a renderer lineage becomes stale', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    await commerce.approveProof(ready.guest, cart.id);
    await pool.query(`UPDATE app.mockups SET renderer_version = 'stale-fixture' WHERE id = $1`, [
      cart.item?.mockupId,
    ]);
    const refreshed = await commerce.getCart(ready.guest, cart.id);
    expect(refreshed.item?.mockupId).not.toBe(cart.item?.mockupId);
    expect(refreshed.proofApproved).toBe(false);
  });

  it('uses server-owned minor-unit pricing, configurable quantity discount/free shipping, and validated addresses', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 3,
    });
    await commerce.approveProof(ready.guest, cart.id);
    await expect(
      commerce.saveShippingAddress(ready.guest, cart.id, { ...address(), postalCode: 'bad' }),
    ).rejects.toBeInstanceOf(CommerceValidationError);
    const addressId = await commerce.saveShippingAddress(ready.guest, cart.id, address());
    const checkout = await commerce.startCheckout(ready.guest, cart.id, {
      shippingAddressId: addressId,
      billingAddress: {
        recipientName: 'Jordan Billing',
        line1: '99 Billing Avenue',
        line2: 'Suite 12',
        city: 'Miami',
        stateCode: 'FL',
        postalCode: '33130',
        countryCode: 'US',
      },
      idempotencyKey: `checkout-${randomBytes(8).toString('hex')}`,
    });
    expect(checkout.pricing).toMatchObject({
      unitRetailCents: 3999,
      quantity: 3,
      discountCents: 1200,
      subtotalCents: 10797,
      customerShippingCents: 0,
      freeShippingApplied: true,
      taxCents: 945,
      totalCents: 11742,
    });
    expect(checkout.shipping).toMatchObject({
      provisional: true,
      providerShippingCostCents: 550,
      customerShippingCents: 0,
    });
    expect(checkout.shipping.groups).toHaveLength(1);
    const checkoutGroups = await pool.query<{ group_count: number; item_count: number }>(
      `SELECT COUNT(DISTINCT fulfillment_group.id)::int AS group_count,
              COUNT(fulfillment_item.cart_item_id)::int AS item_count
       FROM app.checkout_fulfillment_groups fulfillment_group
       LEFT JOIN app.checkout_fulfillment_group_items fulfillment_item
         ON fulfillment_item.fulfillment_group_id = fulfillment_group.id
       WHERE fulfillment_group.checkout_attempt_id = $1`,
      [checkout.id],
    );
    expect(checkoutGroups.rows[0]).toEqual({ group_count: 1, item_count: 1 });
    expect(checkout.tax).toMatchObject({ provider: 'FAKE', taxableSubtotalCents: 10797 });
    const billing = await pool.query<{ billing_address_snapshot: unknown }>(
      `SELECT billing_address_snapshot FROM app.checkout_attempts WHERE id = $1`,
      [checkout.id],
    );
    expect(billing.rows[0]?.billing_address_snapshot).toMatchObject({
      recipientName: 'Jordan Billing',
      city: 'Miami',
      stateCode: 'FL',
      postalCode: '33130',
    });
  });

  it('captures checkout language while preserving an explicit admin override', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    const email = `locale-${randomBytes(6).toString('hex')}@example.test`;

    await commerce.saveShippingAddress(ready.guest, cart.id, {
      ...address(),
      email,
      preferredLocale: 'en',
    });
    const detected = await pool.query<{
      preferred_locale: string;
      preferred_locale_source: string;
    }>(
      `SELECT preferred_locale, preferred_locale_source
       FROM app.customer_profiles WHERE normalized_email=$1`,
      [email],
    );
    expect(detected.rows[0]).toEqual({
      preferred_locale: 'en',
      preferred_locale_source: 'BROWSER',
    });

    await pool.query(
      `UPDATE app.customer_profiles
       SET preferred_locale='en', preferred_locale_source='ADMIN'
       WHERE normalized_email=$1`,
      [email],
    );
    await commerce.saveShippingAddress(ready.guest, cart.id, {
      ...address(),
      email,
      preferredLocale: 'en',
    });
    const overridden = await pool.query<{
      preferred_locale: string;
      preferred_locale_source: string;
    }>(
      `SELECT preferred_locale, preferred_locale_source
       FROM app.customer_profiles WHERE normalized_email=$1`,
      [email],
    );
    expect(overridden.rows[0]).toEqual({
      preferred_locale: 'en',
      preferred_locale_source: 'ADMIN',
    });
  });

  it('supports safe guest checkout, verified idempotent payment events, and canonical PAID order state only', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    await commerce.approveProof(ready.guest, cart.id);
    const addressId = await commerce.saveShippingAddress(ready.guest, cart.id, address());
    const checkout = await commerce.startCheckout(ready.guest, cart.id, {
      shippingAddressId: addressId,
      billingAddress: null,
      idempotencyKey: `checkout-${randomBytes(8).toString('hex')}`,
    });
    const paid = await commerce.simulateFakePayment(ready.guest, checkout.id, 'SUCCEEDED');
    const repeated = await commerce.simulateFakePayment(ready.guest, checkout.id, 'SUCCEEDED');
    expect(paid).toMatchObject({ duplicate: false, orderNumber: expect.stringMatching(/^#\d+$/) });
    expect(repeated).toEqual({ duplicate: true, orderNumber: paid.orderNumber });
    const order = await commerce.getOrder(ready.guest, paid.orderNumber as string);
    expect(order).toMatchObject({ status: 'PAID' });
    const fulfillmentGroups = await pool.query<{ group_count: number; item_count: number }>(
      `SELECT COUNT(DISTINCT fulfillment_group.id)::int AS group_count,
              COUNT(fulfillment_item.order_item_id)::int AS item_count
       FROM app.order_fulfillment_groups fulfillment_group
       LEFT JOIN app.order_fulfillment_group_items fulfillment_item
         ON fulfillment_item.fulfillment_group_id = fulfillment_group.id
       JOIN app.orders orders ON orders.id = fulfillment_group.order_id
       WHERE orders.order_number = $1`,
      [paid.orderNumber],
    );
    expect(fulfillmentGroups.rows[0]).toEqual({ group_count: 1, item_count: 1 });
    const addressSnapshots = await pool.query<{
      shipping_address_snapshot: Record<string, unknown>;
      billing_address_snapshot: Record<string, unknown>;
      customer_profile_id: string | null;
    }>(
      `SELECT shipping_address_snapshot, billing_address_snapshot, customer_profile_id
       FROM app.orders WHERE order_number = $1`,
      [paid.orderNumber],
    );
    expect(addressSnapshots.rows[0]?.billing_address_snapshot).toEqual(
      addressSnapshots.rows[0]?.shipping_address_snapshot,
    );
    expect(addressSnapshots.rows[0]?.customer_profile_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(fulfillment.createCalls).toBe(0);
    expect(fulfillment.submitCalls).toBe(0);
    await expect(
      commerce.getOrder(await identity.createGuestSession(), paid.orderNumber as string),
    ).resolves.toBeNull();

    const orderId = (
      await pool.query<{ id: string }>(`SELECT id FROM app.orders WHERE order_number = $1`, [
        paid.orderNumber,
      ])
    ).rows[0]!.id;
    await pool.query(`UPDATE app.orders SET status = 'DELIVERED' WHERE id = $1`, [orderId]);
    expect((await integrityViolationCounts(pool)).delivered_without_shipment).toBe(1);

    // A canonical provider delivery event is authoritative even before a carrier record arrives.
    await pool.query(
      `INSERT INTO app.order_fulfillment_status_events
         (order_id, source, raw_status, normalized_status, disposition)
       VALUES ($1, 'WEBHOOK', 'delivered', 'DELIVERED', 'APPLIED')`,
      [orderId],
    );
    expect((await integrityViolationCounts(pool)).delivered_without_shipment).toBe(0);
  });

  it('records a verified payment even when its delivery quote expires during payment completion', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    await commerce.approveProof(ready.guest, cart.id);
    const shippingAddressId = await commerce.saveShippingAddress(ready.guest, cart.id, address());
    const checkout = await commerce.startCheckout(ready.guest, cart.id, {
      shippingAddressId,
      billingAddress: null,
      idempotencyKey: `late-payment-${randomBytes(8).toString('hex')}`,
    });
    await pool.query(
      `UPDATE app.checkout_attempts SET price_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [checkout.id],
    );

    const paid = await commerce.simulateFakePayment(ready.guest, checkout.id, 'SUCCEEDED');

    expect(paid.orderNumber).toMatch(/^#\d+$/);
    expect(await commerce.getOrder(ready.guest, paid.orderNumber as string)).toMatchObject({
      status: 'PAID',
    });
  });

  it('expires an abandoned checkout before starting a fresh checkout attempt', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    await commerce.approveProof(ready.guest, cart.id);
    const shippingAddressId = await commerce.saveShippingAddress(ready.guest, cart.id, address());
    const first = await commerce.startCheckout(ready.guest, cart.id, {
      shippingAddressId,
      billingAddress: null,
      idempotencyKey: `expired-checkout-${randomBytes(8).toString('hex')}`,
    });
    await pool.query(
      `UPDATE app.checkout_attempts SET price_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [first.id],
    );

    const replacement = await commerce.startCheckout(ready.guest, cart.id, {
      shippingAddressId,
      billingAddress: null,
      idempotencyKey: `replacement-checkout-${randomBytes(8).toString('hex')}`,
    });

    expect(replacement.id).not.toBe(first.id);
    expect((await commerce.getCheckout(ready.guest, first.id)).status).toBe('EXPIRED');
  });

  it('releases a cart for a fresh checkout when payment-intent creation fails', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    await commerce.approveProof(ready.guest, cart.id);
    const shippingAddressId = await commerce.saveShippingAddress(ready.guest, cart.id, address());
    const failingCommerce = new CommerceService(
      pool,
      {
        createIntent: async () => {
          throw new Error('Payment setup is temporarily unavailable.');
        },
        verifyWebhook: async () => null,
        refund: async () => ({ providerRefundId: 'unused' }),
      },
      new FakeTaxService(875),
      fulfillment,
      new MockupService(pool, storage),
    );

    await expect(
      failingCommerce.startCheckout(ready.guest, cart.id, {
        shippingAddressId,
        billingAddress: null,
        idempotencyKey: `failed-intent-${randomBytes(8).toString('hex')}`,
      }),
    ).rejects.toThrow('Payment setup is temporarily unavailable.');
    const failed = await pool.query<{ status: string }>(
      `SELECT status FROM app.checkout_attempts WHERE cart_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [cart.id],
    );
    expect(failed.rows[0]?.status).toBe('PAYMENT_FAILED');

    await expect(
      commerce.startCheckout(ready.guest, cart.id, {
        shippingAddressId,
        billingAddress: null,
        idempotencyKey: `retry-intent-${randomBytes(8).toString('hex')}`,
      }),
    ).resolves.toMatchObject({ status: 'PAYMENT_PENDING' });
  });

  it('rejects incomplete billing details before a checkout attempt is created', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    await commerce.approveProof(ready.guest, cart.id);
    const shippingAddressId = await commerce.saveShippingAddress(ready.guest, cart.id, address());
    await expect(
      commerce.startCheckout(ready.guest, cart.id, {
        shippingAddressId,
        billingAddress: {
          recipientName: 'Incomplete Billing',
          line1: '7 Main Street',
          city: '',
          stateCode: 'CA',
          postalCode: '94107',
          countryCode: 'US',
        },
        idempotencyKey: `invalid-billing-${randomBytes(8).toString('hex')}`,
      }),
    ).rejects.toBeInstanceOf(CommerceValidationError);
    const attempts = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.checkout_attempts WHERE cart_id = $1`,
      [cart.id],
    );
    expect(attempts.rows[0]?.count).toBe('0');
  });

  it('preserves guest cart and order ownership when the guest becomes an account', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    const account = await identity.register(
      ready.guest,
      `commerce-${randomBytes(6).toString('hex')}@example.test`,
      'correct-horse-battery-staple',
    );
    await expect(commerce.getCart(account, cart.id)).resolves.toMatchObject({ id: cart.id });
  });

  describe('shared order refund transaction boundary', () => {
    afterEach(() => vi.unstubAllGlobals());

    async function fixture() {
      const ready = await readyProject(pool, identity, projects, storage);
      const cart = await commerce.createCart(ready.guest, {
        projectId: ready.projectId,
        size: 'M',
        quantity: 1,
      });
      await commerce.approveProof(ready.guest, cart.id);
      const addressId = await commerce.saveShippingAddress(ready.guest, cart.id, {
        ...address(),
        email: `refund-${randomUUID()}@example.test`,
      });
      const checkout = await commerce.startCheckout(ready.guest, cart.id, {
        shippingAddressId: addressId,
        billingAddress: null,
        idempotencyKey: randomUUID(),
      });
      const paid = await commerce.simulateFakePayment(ready.guest, checkout.id, 'SUCCEEDED');
      const orderNumber = paid.orderNumber!;
      const row = (
        await pool.query<{
          id: string;
          customer_profile_id: string;
          payment_id: string;
          amount_cents: number;
        }>(
          `SELECT o.id, o.customer_profile_id, p.id AS payment_id, p.amount_cents
          FROM app.orders o JOIN app.payments p ON p.checkout_attempt_id=o.checkout_attempt_id
          WHERE o.order_number=$1`,
          [orderNumber],
        )
      ).rows[0]!;
      const staff = {
        type: 'STAFF' as const,
        role: 'OPERATIONS' as const,
        staffMemberId: randomUUID(),
        email: `refund-staff-${randomUUID()}@example.test`,
      };
      await pool.query(
        `INSERT INTO app.staff_members (id,normalized_email,role,status)
        VALUES ($1,$2,'OPERATIONS','ACTIVE')`,
        [staff.staffMemberId, staff.email],
      );
      await pool.query(`UPDATE app.payments SET provider='STRIPE' WHERE id=$1`, [row.payment_id]);
      const input = (amountCents = 1200, idempotencyKey: string = randomUUID()) => ({
        orderNumber,
        amountCents,
        idempotencyKey,
        reasonCode: 'CUSTOMER_REQUEST',
        note: 'Support approved',
      });
      return { ...row, orderNumber, staff, input };
    }

    function service() {
      expect(domain.OrderRefundService).toBeTypeOf('function');
      return new domain.OrderRefundService(pool, new StripePaymentService('fixture', 'fixture'));
    }

    function transport(beforeResponse?: () => Promise<void>, fail = false) {
      const requests: { amountCents: number; paymentId: string | null; key: string | null }[] = [];
      vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
        expect(url).toBe('https://api.stripe.com/v1/refunds');
        expect(init.method).toBe('POST');
        const form = new URLSearchParams(String(init.body));
        const key = new Headers(init.headers).get('Idempotency-Key');
        requests.push({
          amountCents: Number(form.get('amount')),
          paymentId: form.get('payment_intent'),
          key,
        });
        await beforeResponse?.();
        return new Response(JSON.stringify({ id: `re_${key}` }), { status: fail ? 503 : 200 });
      });
      return requests;
    }

    async function state(orderId: string) {
      const refunds = await pool.query(`SELECT * FROM app.order_refunds WHERE order_id=$1`, [
        orderId,
      ]);
      const ledger = await pool.query(
        `SELECT l.* FROM app.store_credit_ledger l
        JOIN app.store_credit_accounts a ON a.id=l.store_credit_account_id
        JOIN app.orders o ON o.customer_profile_id=a.customer_profile_id WHERE o.id=$1`,
        [orderId],
      );
      const balance = (
        await pool.query<{ balance: number }>(
          `SELECT coalesce(a.current_balance_cents,0) AS balance
        FROM app.orders o LEFT JOIN app.store_credit_accounts a ON a.customer_profile_id=o.customer_profile_id
        WHERE o.id=$1`,
          [orderId],
        )
      ).rows[0]!.balance;
      return { refunds: refunds.rows, ledger: ledger.rows, balance };
    }

    async function failSuccessAudit(orderId: string) {
      const name = `refund_test_${randomBytes(8).toString('hex')}`;
      await pool.query(`CREATE FUNCTION app.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.order_id = '${orderId}'::uuid AND NEW.action='refund_succeeded' THEN
          RAISE EXCEPTION 'fixture finalization failure'; END IF; RETURN NEW; END; $$`);
      await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON app.order_operational_audits
        FOR EACH ROW EXECUTE FUNCTION app.${name}()`);
      return async () => {
        await pool.query(`DROP TRIGGER ${name} ON app.order_operational_audits`);
        await pool.query(`DROP FUNCTION app.${name}()`);
      };
    }

    // A lost actor/key/amount mapping would debit the provider incorrectly or corrupt the audit.
    it('refunds original payment for staff with the persisted amount and unchanged provider key', async () => {
      const f = await fixture();
      const refunds = service();
      const requests = transport();
      const input = f.input();
      const first = await refunds.refundOriginalPayment(f.staff, input);
      const duplicate = await refunds.refundOriginalPayment(f.staff, {
        ...input,
        amountCents: 100,
      });
      expect(first).toMatchObject({
        destination: 'ORIGINAL_PAYMENT',
        amountCents: 1200,
        status: 'SUCCEEDED',
        duplicate: false,
        providerRefundId: `re_${input.idempotencyKey}`,
      });
      expect(duplicate).toEqual({ ...first, duplicate: true });
      expect(requests).toEqual([
        {
          amountCents: 1200,
          paymentId: expect.stringMatching(/^fake_pi_/),
          key: input.idempotencyKey,
        },
      ]);
      expect(await state(f.id)).toMatchObject({
        balance: 0,
        ledger: [],
        refunds: [
          {
            id: first.refundId,
            amount_cents: 1200,
            initiated_by_staff_member_id: f.staff.staffMemberId,
            initiated_by_user_id: null,
            payment_id: f.payment_id,
            status: 'SUCCEEDED',
            notes: 'Support approved',
          },
        ],
      });
      expect(
        (
          await pool.query(
            `SELECT actor_staff_member_id,actor_user_id FROM app.order_operational_audits
        WHERE order_id=$1 AND action IN ('refund_requested','refund_succeeded')`,
            [f.id],
          )
        ).rows,
      ).toEqual([
        { actor_staff_member_id: f.staff.staffMemberId, actor_user_id: null },
        { actor_staff_member_id: f.staff.staffMemberId, actor_user_id: null },
      ]);
    });

    // Accepting ordinary customers as operations actors would bypass the existing CX role check.
    it('preserves USER CX authorization and the public CX provider result', async () => {
      const f = await fixture();
      const refunds = service();
      const requests = transport();
      const email = `refund-user-${randomUUID()}@example.test`;
      const account = await identity.register(
        await identity.createGuestSession(),
        email,
        'correct-horse-battery-staple',
      );
      const actor = { type: 'USER' as const, userId: account.userId!, email };
      await expect(refunds.refundOriginalPayment(actor, f.input())).rejects.toThrow(
        'Operations access is restricted.',
      );
      await pool.query(`UPDATE app.users SET role='CX_OPS' WHERE id=$1`, [account.userId]);
      const input = f.input(100);
      const cx = new CxOperationsService(pool, new StripePaymentService('fixture', 'fixture'));
      const first = await cx.refund(account, { ...input, notes: 'Legacy CX note' });
      expect(first).toEqual({
        providerRefundId: `re_${input.idempotencyKey}`,
        duplicate: false,
        status: 'SUCCEEDED',
      });
      expect(await cx.refund(account, input)).toEqual({ ...first, duplicate: true });
      expect((await state(f.id)).refunds).toMatchObject([
        {
          initiated_by_user_id: account.userId,
          initiated_by_staff_member_id: null,
          notes: 'Legacy CX note',
          amount_cents: 100,
        },
      ]);
      expect(requests.map((request) => request.amountCents)).toEqual([100]);
    });

    // Reading only succeeded refunds or locking after the cap check would allow concurrent over-refunds.
    it('counts pending and succeeded refunds across both destinations while the provider is in flight', async () => {
      const f = await fixture();
      const refunds = service();
      await refunds.refundToStoreCredit(f.staff, f.input(200));
      let started!: () => void;
      let release!: () => void;
      const inFlight = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requests = transport(async () => {
        started();
        await gate;
      });
      const input = f.input(f.amount_cents - 300);
      const pending = refunds.refundOriginalPayment(f.staff, input);
      await inFlight;
      try {
        expect(await refunds.refundOriginalPayment(f.staff, input)).toMatchObject({
          status: 'PENDING',
          duplicate: true,
        });
        await expect(refunds.refundOriginalPayment(f.staff, f.input(101))).rejects.toThrow(
          'Refund exceeds the captured payment.',
        );
        await expect(refunds.refundToStoreCredit(f.staff, f.input(101))).rejects.toThrow(
          'Refund exceeds the captured payment.',
        );
        expect((await state(f.id)).refunds).toHaveLength(2);
      } finally {
        release();
        await pending;
      }
      await refunds.refundToStoreCredit(f.staff, f.input(100));
      expect((await state(f.id)).balance).toBe(300);
      expect(requests.map((request) => request.amountCents)).toEqual([f.amount_cents - 300]);
      await expect(refunds.refundToStoreCredit(f.staff, f.input(1))).rejects.toThrow(
        'Refund exceeds the captured payment.',
      );
    });

    // Duplicate or competing ledger refunds must serialize on the order, even for a brand-new account.
    it('serializes competing Store Credit refunds and makes simultaneous retries apply once', async () => {
      const f = await fixture();
      const refunds = service();
      const input = f.input(1200);
      const retries = await Promise.all([
        refunds.refundToStoreCredit(f.staff, input),
        refunds.refundToStoreCredit(f.staff, input),
      ]);
      expect(retries.map((refund) => refund.duplicate).sort()).toEqual([false, true]);
      expect(retries[0]?.refundId).toBe(retries[1]?.refundId);
      expect((await state(f.id)).balance).toBe(1200);
      const outcomes = await Promise.allSettled([
        refunds.refundToStoreCredit(f.staff, f.input(f.amount_cents - 1200)),
        refunds.refundToStoreCredit(f.staff, f.input(f.amount_cents - 1200)),
      ]);
      const persisted = await state(f.id);
      expect(persisted.balance).toBe(f.amount_cents);
      expect(persisted.refunds).toHaveLength(2);
      expect(persisted.ledger).toHaveLength(2);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toMatchObject([
        { reason: new Error('Refund exceeds the captured payment.') },
      ]);
      expect(
        await refunds.refundToStoreCredit(f.staff, { ...input, amountCents: 1 }),
      ).toMatchObject({ refundId: retries[0]?.refundId, duplicate: true, amountCents: 1200 });
      expect((await state(f.id)).balance).toBe(f.amount_cents);
    });

    // A Store Credit path calling the provider or failing to link its ledger can issue money twice.
    it('commits the Store Credit balance, ledger, and refund link without Return or fulfillment changes', async () => {
      const f = await fixture();
      const refunds = service();
      const requests = transport();
      const before = (
        await pool.query(`SELECT * FROM app.order_fulfillment_groups WHERE order_id=$1`, [f.id])
      ).rows;
      const input = f.input(1200);
      const first = await refunds.refundToStoreCredit(f.staff, input);
      expect(first).toMatchObject({
        amountCents: 1200,
        destination: 'STORE_CREDIT',
        status: 'SUCCEEDED',
        duplicate: false,
      });
      expect(await refunds.refundOriginalPayment(f.staff, input)).toEqual({
        ...first,
        duplicate: true,
      });
      const persisted = await state(f.id);
      expect(persisted.balance).toBe(1200);
      expect(persisted.ledger).toMatchObject([
        {
          entry_type: 'CREDIT',
          amount_cents: 1200,
          balance_after_cents: 1200,
          reason: 'REFUND',
          actor_staff_member_id: f.staff.staffMemberId,
        },
      ]);
      expect(persisted.refunds).toMatchObject([
        {
          id: first.refundId,
          destination: 'STORE_CREDIT',
          provider: null,
          provider_refund_id: null,
          store_credit_ledger_entry_id: (persisted.ledger[0] as { id: string }).id,
        },
      ]);
      expect(requests).toEqual([]);
      expect(
        (await pool.query(`SELECT id FROM app.order_returns WHERE order_id=$1`, [f.id])).rows,
      ).toEqual([]);
      expect(
        (await pool.query(`SELECT * FROM app.order_fulfillment_groups WHERE order_id=$1`, [f.id]))
          .rows,
      ).toEqual(before);
      expect(
        (await pool.query<{ status: string }>(`SELECT status FROM app.orders WHERE id=$1`, [f.id]))
          .rows[0]?.status,
      ).toBe('PAID');
    });

    // A provider rejection must release the reservation; retrying its key must not call the provider again.
    it('persists failed provider refunds and allows a new operation to use the released amount', async () => {
      const f = await fixture();
      const refunds = service();
      const requests = transport(undefined, true);
      const input = f.input(f.amount_cents);
      await expect(refunds.refundOriginalPayment(f.staff, input)).rejects.toThrow(
        'Stripe could not process the refund.',
      );
      expect(await refunds.refundOriginalPayment(f.staff, input)).toMatchObject({
        status: 'FAILED',
        duplicate: true,
      });
      expect(requests.map((request) => request.amountCents)).toEqual([f.amount_cents]);
      await refunds.refundToStoreCredit(f.staff, f.input(f.amount_cents));
      expect((await state(f.id)).balance).toBe(f.amount_cents);
    });

    // Committing the helper independently would leave spendable credit after the refund transaction fails.
    it('rolls back Store Credit, its ledger, and its refund when finalization fails', async () => {
      const f = await fixture();
      const refunds = service();
      const removeFailure = await failSuccessAudit(f.id);
      const input = f.input();
      try {
        await expect(refunds.refundToStoreCredit(f.staff, input)).rejects.toThrow(
          'fixture finalization failure',
        );
        expect(await state(f.id)).toEqual({ balance: 0, ledger: [], refunds: [] });
      } finally {
        await removeFailure();
      }
      await refunds.refundToStoreCredit(f.staff, input);
      expect((await state(f.id)).balance).toBe(1200);
    });

    // A database failure after external success must not free the reserved money for a second refund.
    it('keeps a provider-success reservation pending if local finalization rolls back', async () => {
      const f = await fixture();
      const refunds = service();
      const requests = transport();
      const removeFailure = await failSuccessAudit(f.id);
      const input = f.input(f.amount_cents);
      try {
        await expect(refunds.refundOriginalPayment(f.staff, input)).rejects.toThrow(
          'fixture finalization failure',
        );
      } finally {
        await removeFailure();
      }
      expect((await state(f.id)).refunds).toMatchObject([
        { status: 'PENDING', amount_cents: f.amount_cents },
      ]);
      expect(await refunds.refundOriginalPayment(f.staff, input)).toMatchObject({
        status: 'PENDING',
        duplicate: true,
      });
      await expect(refunds.refundToStoreCredit(f.staff, f.input(1))).rejects.toThrow(
        'Refund exceeds the captured payment.',
      );
      expect(requests.map((request) => request.amountCents)).toEqual([f.amount_cents]);
    });

    // The helper must participate in its caller's transaction without an internal commit.
    it('composes the ledger helper with a caller rollback and a later successful adjustment', async () => {
      const f = await fixture();
      expect(storeCredit.adjustStoreCreditWithClient).toBeTypeOf('function');
      const input = {
        direction: 'CREDIT' as const,
        amount: '12.34',
        reason: 'REFUND' as const,
        idempotencyKey: randomUUID(),
      };
      await expect(
        withTransaction(pool, async (client) => {
          expect(
            await storeCredit.adjustStoreCreditWithClient(
              client,
              f.staff,
              f.customer_profile_id,
              input,
            ),
          ).toMatchObject({ balanceCents: 1234, duplicate: false });
          throw new Error('caller rollback');
        }),
      ).rejects.toThrow('caller rollback');
      expect(await state(f.id)).toEqual({ balance: 0, ledger: [], refunds: [] });
      await new storeCredit.StoreCreditService(pool).adjust(f.staff, f.customer_profile_id, input);
      expect((await state(f.id)).balance).toBe(1234);
    });

    // USD-only credit cannot silently convert a persisted payment in another currency.
    it('rejects currency mismatch and missing customer linkage without issuing Store Credit', async () => {
      const f = await fixture();
      const refunds = service();
      await pool.query(`UPDATE app.payments SET currency='EUR' WHERE id=$1`, [f.payment_id]);
      await expect(refunds.refundToStoreCredit(f.staff, f.input())).rejects.toThrow(
        'Store Credit refunds require a USD order payment.',
      );
      await pool.query(`UPDATE app.payments SET currency='USD' WHERE id=$1`, [f.payment_id]);
      await pool.query(`UPDATE app.orders SET customer_profile_id=NULL WHERE id=$1`, [f.id]);
      await expect(refunds.refundToStoreCredit(f.staff, f.input())).rejects.toThrow(
        'Order customer is unavailable.',
      );
      expect(await state(f.id)).toEqual({ balance: 0, ledger: [], refunds: [] });
    });
  });

  it('keeps CX refunds idempotent and reprints isolated from the original M7 production workflow', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    await commerce.approveProof(ready.guest, cart.id);
    const addressId = await commerce.saveShippingAddress(ready.guest, cart.id, address());
    const checkout = await commerce.startCheckout(ready.guest, cart.id, {
      shippingAddressId: addressId,
      billingAddress: null,
      idempotencyKey: `cx-${randomBytes(8).toString('hex')}`,
    });
    const paid = await commerce.simulateFakePayment(ready.guest, checkout.id, 'SUCCEEDED');
    const orderNumber = paid.orderNumber as string;
    const operator = await identity.register(
      await identity.createGuestSession(),
      `cx-${randomBytes(6).toString('hex')}@example.test`,
      'correct-horse-battery-staple',
    );
    await pool.query(`UPDATE app.users SET role = 'CX_OPS' WHERE id = $1`, [operator.userId]);
    const payment = new FakePaymentService();
    const cx = new CxOperationsService(pool, payment);

    await expect(
      cx.refund(ready.guest, {
        orderNumber,
        amountCents: 100,
        reasonCode: 'CUSTOMER_REQUEST',
        idempotencyKey: `refund-${orderNumber}`,
      }),
    ).rejects.toThrow('Operations access is restricted.');
    const reviewer = await identity.register(
      await identity.createGuestSession(),
      `reviewer-${randomBytes(6).toString('hex')}@example.test`,
      'correct-horse-battery-staple',
    );
    await pool.query(`UPDATE app.users SET role = 'PREPRESS_REVIEWER' WHERE id = $1`, [
      reviewer.userId,
    ]);
    await expect(cx.search(reviewer, orderNumber)).rejects.toThrow(
      'Operations access is restricted.',
    );
    await expect(
      cx.createReprint(reviewer, {
        orderNumber,
        orderItemId: '00000000-0000-0000-0000-000000000000',
        reasonCode: 'PRODUCTION_DEFECT',
      }),
    ).rejects.toThrow('Operations access is restricted.');
    await expect(
      cx.dashboard(reviewer, new Date('2020-01-01T00:00:00.000Z'), new Date()),
    ).rejects.toThrow('Operations access is restricted.');
    await expect(
      cx.analyticsReport(reviewer, new Date('2020-01-01T00:00:00.000Z'), new Date()),
    ).rejects.toThrow('Operations access is restricted.');
    await expect(cx.visibility(reviewer)).rejects.toThrow('Operations access is restricted.');
    const [first, duplicate] = await Promise.all([
      cx.refund(operator, {
        orderNumber,
        amountCents: 100,
        reasonCode: 'CUSTOMER_REQUEST',
        idempotencyKey: `refund-${orderNumber}`,
      }),
      cx.refund(operator, {
        orderNumber,
        amountCents: 100,
        reasonCode: 'CUSTOMER_REQUEST',
        idempotencyKey: `refund-${orderNumber}`,
      }),
    ]);
    expect(
      (
        await pool.query(
          `SELECT r.amount_cents, r.status FROM app.order_refunds r JOIN app.orders o ON o.id=r.order_id
       WHERE o.order_number=$1`,
          [orderNumber],
        )
      ).rows,
    ).toEqual([{ amount_cents: 100, status: 'SUCCEEDED' }]);
    expect([first.duplicate, duplicate.duplicate].filter(Boolean)).toHaveLength(1);
    await expect(
      cx.refund(operator, {
        orderNumber,
        amountCents: 999999,
        reasonCode: 'CUSTOMER_REQUEST',
        idempotencyKey: `over-cap-${orderNumber}`,
      }),
    ).rejects.toThrow('Refund exceeds the captured payment.');
    const item = await pool.query<{ id: string }>(
      `SELECT id FROM app.order_items WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)`,
      [orderNumber],
    );
    const reprint = await cx.createReprint(operator, {
      orderNumber,
      orderItemId: item.rows[0]!.id,
      reasonCode: 'PRODUCTION_DEFECT',
      estimatedCostCents: 725,
    });
    await expect(cx.approveReprint(operator, reprint.id, true)).rejects.toThrow(
      'Reprint provider must be requalified before approval.',
    );
    const original = await commerce.getOrder(ready.guest, orderNumber);
    expect(original?.status).toBe('PAID');
    const reprintRow = await pool.query<{ status: string; original_order_item_id: string }>(
      `SELECT status, original_order_item_id FROM app.order_reprints WHERE id = $1`,
      [reprint.id],
    );
    expect(reprintRow.rows[0]).toEqual({
      status: 'PENDING_REVIEW',
      original_order_item_id: item.rows[0]!.id,
    });
    await cx.recordProviderDefect(operator, {
      orderNumber,
      defectCode: 'MISPRINT',
      reprintId: reprint.id,
    });
    const defect = await pool.query<{
      defect_code: string;
      reprint_id: string;
      order_item_id: string;
      product_model_id: string;
    }>(
      `SELECT defect_code, reprint_id, order_item_id, product_model_id FROM app.provider_defects WHERE reprint_id = $1`,
      [reprint.id],
    );
    expect(defect.rows[0]).toMatchObject({
      defect_code: 'MISPRINT',
      reprint_id: reprint.id,
      order_item_id: item.rows[0]!.id,
      product_model_id: 'essential-dtg-tee',
    });
    await cx.addCustomerNote(operator, {
      orderNumber,
      customerEmail: `cx-note-${randomBytes(4).toString('hex')}@example.test`,
      body: 'Customer requested a delivery update.',
    });
    expect(
      (
        await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM app.order_operational_audits WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1) AND action = 'customer_note_added'`,
          [orderNumber],
        )
      ).rows[0]?.count,
    ).toBe('1');
    expect(
      (
        await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM app.order_fulfillment_groups
           WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)
             AND external_order_id IS NOT NULL`,
          [orderNumber],
        )
      ).rows[0]?.count,
    ).toBe('0');
  });

  it('uses trusted review, fresh final routing, derivative readiness, and one idempotent production boundary', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    await commerce.approveProof(ready.guest, cart.id);
    const addressId = await commerce.saveShippingAddress(ready.guest, cart.id, address());
    const checkout = await commerce.startCheckout(ready.guest, cart.id, {
      shippingAddressId: addressId,
      billingAddress: null,
      idempotencyKey: `operations-${randomBytes(8).toString('hex')}`,
    });
    const paid = await commerce.simulateFakePayment(ready.guest, checkout.id, 'SUCCEEDED');
    const orderNumber = paid.orderNumber as string;

    const masterKey = `operations/${randomBytes(6).toString('hex')}.png`;
    await storage.put({
      key: masterKey,
      body: new Uint8Array([137, 80, 78, 71]),
      contentType: 'image/png',
    });
    const master = await pool.query<{ id: string }>(
      `INSERT INTO app.assets (project_id, asset_type, storage_key, content_type, byte_size, width, height)
       VALUES ($1, 'PRODUCTION_MASTER', $2, 'image/png', 4, 3600, 4800) RETURNING id`,
      [ready.projectId, masterKey],
    );
    await pool.query(`UPDATE app.prepress_runs SET production_master_asset_id = $2 WHERE id = $1`, [
      ready.prepressRunId,
      master.rows[0]?.id,
    ]);
    await createOperationalCandidate(pool);

    const admin = await identity.createGuestSession();
    const account = await identity.register(
      admin,
      `ops-${randomBytes(6).toString('hex')}@example.test`,
      'correct-horse-battery-staple',
    );
    await pool.query(`UPDATE app.users SET role = 'ADMIN' WHERE id = $1`, [account.userId]);
    const staff = await pool.query<{ id: string; normalized_email: string }>(
      `INSERT INTO app.staff_members (normalized_email, role, status, activated_at)
       VALUES ($1, 'OPERATIONS', 'ACTIVE', now()) RETURNING id, normalized_email`,
      [`staff-ops-${randomBytes(6).toString('hex')}@example.test`],
    );
    const staffSession = {
      id: randomUUID(),
      staffMemberId: staff.rows[0]!.id,
      email: staff.rows[0]!.normalized_email,
      role: 'OPERATIONS' as const,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const fulfillment = new OperationsFulfillment();
    const operations = new OrderOperationsService(pool, storage, fulfillment, {
      fulfillmentAdapter: 'fake',
      realProductionSubmissionEnabled: false,
    });

    await expect(operations.listFulfillmentGroups(ready.guest, orderNumber)).rejects.toBeInstanceOf(
      OrderOperationsAccessError,
    );
    await expect(operations.getOperationalOrder(ready.guest, orderNumber)).rejects.toBeInstanceOf(
      OrderOperationsAccessError,
    );
    expect(
      (await operations.listReviewQueue(account, { view: 'NEEDS_REVIEW' })).map(
        (order) => order.orderNumber,
      ),
    ).toContain(orderNumber);
    expect(await operations.getOperationsDashboard(account)).toMatchObject({
      queues: { needsReview: expect.any(Number) },
      recentOrders: expect.arrayContaining([expect.objectContaining({ orderNumber })]),
    });
    expect(await operations.getOperationalOrder(account, orderNumber)).toMatchObject({
      orderNumber,
      status: 'PAID',
      fulfillmentGroups: [{ adapterType: 'PRINTIFY', status: 'PENDING' }],
    });
    expect(await operations.getOperationalOrder(staffSession, orderNumber)).toMatchObject({
      orderNumber,
      status: 'PAID',
    });
    const fulfillmentGroups = await operations.listFulfillmentGroups(account, orderNumber);
    expect(fulfillmentGroups).toMatchObject([
      {
        adapterType: 'PRINTIFY',
        status: 'PENDING',
        itemCount: 1,
        externalOrderId: null,
      },
    ]);
    const fulfillmentGroupId = fulfillmentGroups[0]!.id;
    await expect(operations.startPrepressReview(ready.guest, orderNumber)).rejects.toBeInstanceOf(
      OrderOperationsAccessError,
    );
    await operations.startPrepressReview(staffSession, orderNumber);
    expect(
      (
        await pool.query<{ actor_staff_member_id: string | null }>(
          `SELECT actor_staff_member_id FROM app.order_state_history
           WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)
             AND to_state = 'PREPRESS_REVIEW'
           ORDER BY created_at DESC LIMIT 1`,
          [orderNumber],
        )
      ).rows[0]?.actor_staff_member_id,
    ).toBe(staffSession.staffMemberId);
    await operations.decideReview(account, {
      orderNumber,
      stage: 'PREPRESS',
      outcome: 'APPROVED',
      reasonCode: 'PRINTABILITY_CONCERN',
    });
    await operations.decideReview(staffSession, {
      orderNumber,
      stage: 'COMPLIANCE',
      outcome: 'APPROVED',
      reasonCode: 'MODERATION_REVIEW',
    });
    expect(
      (
        await pool.query<{ actor_staff_member_id: string | null }>(
          `SELECT decision.actor_staff_member_id
           FROM app.policy_human_decisions decision
           JOIN app.policy_evaluations evaluation ON evaluation.id = decision.evaluation_id
           JOIN app.orders orders ON orders.id = evaluation.order_id
           WHERE orders.order_number = $1
           ORDER BY decision.created_at DESC LIMIT 1`,
          [orderNumber],
        )
      ).rows[0]?.actor_staff_member_id,
    ).toBe(staffSession.staffMemberId);
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe(
      'READY_FOR_PRODUCTION',
    );
    expect(
      (await operations.listReviewQueue(account, { view: 'READY' })).map(
        (order) => order.orderNumber,
      ),
    ).toContain(orderNumber);
    // The current order-wide routing workflow precedes group routing. For this
    // group-action test, bind the group to the qualification already approved
    // by that workflow; the next slice will make this selection per group.
    await pool.query(
      `UPDATE app.order_fulfillment_groups fulfillment_group
       SET qualification_id = final_routing.selected_qualification_id,
           provider_id = qualification.provider_id,
           updated_at = now()
       FROM LATERAL (
         SELECT selected_qualification_id FROM app.order_final_routing
         WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)
         ORDER BY created_at DESC LIMIT 1
       ) final_routing
       JOIN app.provider_qualifications qualification
         ON qualification.id = final_routing.selected_qualification_id
       WHERE fulfillment_group.id = $2`,
      [orderNumber, fulfillmentGroupId],
    );
    expect(fulfillment.createCalls).toBe(0);
    expect(fulfillment.submitCalls).toBe(0);
    await expect(
      operations.submitFulfillmentGroup(ready.guest, { orderNumber, fulfillmentGroupId }),
    ).rejects.toBeInstanceOf(OrderOperationsAccessError);
    expect(fulfillment.createCalls).toBe(0);
    expect(fulfillment.submitCalls).toBe(0);
    const productionKillSwitch = new OrderOperationsService(pool, storage, fulfillment, {
      fulfillmentAdapter: 'printify',
      realProductionSubmissionEnabled: false,
    });
    await expect(
      productionKillSwitch.submitFulfillmentGroup(account, { orderNumber, fulfillmentGroupId }),
    ).rejects.toThrow(
      'Real production submission is disabled by environment safety configuration.',
    );
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe(
      'READY_FOR_PRODUCTION',
    );
    expect(fulfillment.createCalls).toBe(0);
    expect(fulfillment.submitCalls).toBe(0);

    await pool.query(`UPDATE app.orders SET status = 'ROUTING' WHERE order_number = $1`, [
      orderNumber,
    ]);
    await expect(
      operations.evaluateFulfillmentGroupReadiness(account, { orderNumber, fulfillmentGroupId }),
    ).resolves.toEqual({ ready: true, blockers: [] });
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe(
      'READY_FOR_PRODUCTION',
    );
    expect(fulfillment.createCalls).toBe(0);
    expect(fulfillment.submitCalls).toBe(0);

    fulfillment.failNextCreate = true;
    await expect(
      operations.submitFulfillmentGroup(account, { orderNumber, fulfillmentGroupId }),
    ).rejects.toBeInstanceOf(FulfillmentIntegrationError);
    await pool.query(
      `UPDATE app.order_fulfillment_actions
       SET status = 'PROCESSING', updated_at = now() - interval '6 minutes'
        WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)
          AND fulfillment_group_id = $2
          AND action = 'CREATE_EXTERNAL_ORDER'`,
      [orderNumber, fulfillmentGroupId],
    );
    const gate = fulfillment.pauseNextSubmission();
    const pendingFirst = operations.submitFulfillmentGroup(account, {
      orderNumber,
      fulfillmentGroupId,
    });
    await gate.started;
    await expect(
      operations.submitFulfillmentGroup(account, { orderNumber, fulfillmentGroupId }),
    ).rejects.toBeInstanceOf(OrderTransitionError);
    await expect(
      operations.hold(account, orderNumber, 'OPERATIONAL_HOLD', 'Concurrent hold fixture.'),
    ).rejects.toBeInstanceOf(OrderTransitionError);
    gate.release();
    const first = await pendingFirst;
    const second = await operations.submitFulfillmentGroup(account, {
      orderNumber,
      fulfillmentGroupId,
    });
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ externalOrderId: first.externalOrderId, duplicate: true });
    expect(fulfillment.createCalls).toBe(2);
    expect(fulfillment.submitCalls).toBe(1);
    const externalOrders = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.order_fulfillment_groups fulfillment_group
        JOIN app.orders o ON o.id = fulfillment_group.order_id
        WHERE o.order_number = $1 AND fulfillment_group.external_order_id IS NOT NULL`,
      [orderNumber],
    );
    expect(externalOrders.rows[0]?.count).toBe('1');
    const reclaimedActions = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.order_operational_audits a
       JOIN app.orders o ON o.id = a.order_id
        WHERE o.order_number = $1 AND a.action = 'fulfillment_action_reclaimed'`,
      [orderNumber],
    );
    expect(reclaimedActions.rows[0]?.count).toBe('1');
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe(
      'SUBMITTED_TO_PRINTIFY',
    );
    const siblingExternalOrderId = `fake-order-sibling-${randomBytes(5).toString('hex')}`;
    await pool.query(
      `INSERT INTO app.order_fulfillment_groups (
         order_id, group_key, adapter_type, provider_id, qualification_id, shipping_snapshot,
         status, external_order_id
       )
       SELECT order_id, $2, adapter_type, provider_id, qualification_id, shipping_snapshot,
              'SUBMITTED', $3
       FROM app.order_fulfillment_groups WHERE id = $1`,
      [
        fulfillmentGroupId,
        `fixture-sibling-${randomBytes(5).toString('hex')}`,
        siblingExternalOrderId,
      ],
    );
    const providerEventId = `ops-${randomBytes(5).toString('hex')}`;
    await operations.reconcileStatus({
      externalOrderId: first.externalOrderId,
      rawStatus: 'in_production',
      source: 'WEBHOOK',
      externalEventId: providerEventId,
    });
    await operations.reconcileStatus({
      externalOrderId: first.externalOrderId,
      rawStatus: 'in_production',
      source: 'WEBHOOK',
      externalEventId: providerEventId,
    });
    const independentProductionState = await pool.query<{
      printing_status: string;
      fulfillment_status: string;
    }>(
      `SELECT printing_status, fulfillment_status
       FROM app.order_fulfillment_groups
       WHERE id = $1`,
      [fulfillmentGroupId],
    );
    expect(independentProductionState.rows[0]).toEqual({
      printing_status: 'IN_PRODUCTION',
      fulfillment_status: 'UNFULFILLED',
    });
    const printingEventCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM app.order_printing_status_events
       WHERE fulfillment_group_id = $1 AND external_event_id = $2`,
      [fulfillmentGroupId, providerEventId],
    );
    expect(printingEventCount.rows[0]?.count).toBe('1');
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe('IN_PRODUCTION');
    const trackingNumber = `TRACK-${randomBytes(4).toString('hex')}`;
    const shippedEvent = {
      externalOrderId: first.externalOrderId,
      rawStatus: 'shipped',
      source: 'POLLING' as const,
      externalEventId: `ops-shipped-${randomBytes(5).toString('hex')}`,
      tracking: {
        trackingNumber,
        carrier: 'Fixture Carrier',
      },
    };
    await operations.reconcileStatus(shippedEvent);
    await operations.reconcileStatus(shippedEvent);
    const independentShippedState = await pool.query<{
      printing_status: string;
      fulfillment_status: string;
    }>(
      `SELECT printing_status, fulfillment_status
       FROM app.order_fulfillment_groups
       WHERE id = $1`,
      [fulfillmentGroupId],
    );
    expect(independentShippedState.rows[0]).toEqual({
      printing_status: 'PRINTED',
      fulfillment_status: 'FULFILLED',
    });
    const shipmentAndHistory = await pool.query<{
      shipments: number;
      history: number;
      printing_events: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM app.order_shipments
          WHERE fulfillment_group_id = $1 AND tracking_number = $2) AS shipments,
         (SELECT count(*)::int FROM app.order_fulfillment_status_history
          WHERE fulfillment_group_id = $1 AND to_state = 'FULFILLED') AS history,
         (SELECT count(*)::int FROM app.order_printing_status_events
          WHERE fulfillment_group_id = $1 AND external_event_id = $3) AS printing_events`,
      [fulfillmentGroupId, trackingNumber, shippedEvent.externalEventId],
    );
    expect(shipmentAndHistory.rows[0]).toEqual({ shipments: 1, history: 1, printing_events: 1 });
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe('PARTIALLY_SHIPPED');
    await operations.reconcileStatus({
      externalOrderId: first.externalOrderId,
      rawStatus: 'delivered',
      source: 'WEBHOOK',
      externalEventId: `ops-delivered-${randomBytes(5).toString('hex')}`,
    });
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe('PARTIALLY_SHIPPED');
    await operations.reconcileStatus({
      externalOrderId: siblingExternalOrderId,
      rawStatus: 'shipped',
      source: 'POLLING',
    });
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe('SHIPPED');
    await operations.reconcileStatus({
      externalOrderId: siblingExternalOrderId,
      rawStatus: 'delivered',
      source: 'WEBHOOK',
      externalEventId: `ops-sibling-delivered-${randomBytes(5).toString('hex')}`,
    });
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe('DELIVERED');
    expect(
      (await operations.listFulfillmentGroups(account, orderNumber)).find(
        (group) => group.id === fulfillmentGroupId,
      )?.shipments,
    ).toMatchObject([{ carrier: 'Fixture Carrier', status: 'DELIVERED' }]);
    const orderDetail = new OrderDetailService(pool);
    const adminProjection = await orderDetail.getOrder(staffSession, orderNumber);
    expect(adminProjection).toMatchObject({
      orderNumber,
      paymentState: 'PAID',
      printingState: 'PRINTED',
      fulfillmentState: 'DELIVERED',
      financials: {
        currency: 'USD',
        paymentMethod: 'Credit card',
        taxLines: [
          expect.objectContaining({ label: 'California Sales Tax', rateBasisPoints: 875 }),
        ],
      },
    });
    expect(adminProjection?.groups).toHaveLength(1);
    expect(adminProjection?.groups.every((group) => group.itemCount > 0)).toBe(true);
    expect(adminProjection).not.toHaveProperty('status');
    expect(adminProjection?.groups.find((group) => group.id === fulfillmentGroupId)).toMatchObject({
      printingState: 'PRINTED',
      fulfillmentState: 'DELIVERED',
    });
    expect(
      await orderDetail.getPrintingGroup(staffSession, orderNumber, fulfillmentGroupId),
    ).toMatchObject({
      id: fulfillmentGroupId,
      orderNumber,
      printingState: 'PRINTED',
      fulfillmentState: 'DELIVERED',
    });
    expect(await orderDetail.getPrintingGroup(staffSession, orderNumber, randomUUID())).toBeNull();
    await orderDetail.addOrderNote(staffSession, orderNumber, 'Customer requested gift packaging.');
    await orderDetail.replaceOrderTags(staffSession, orderNumber, [
      'Priority',
      'priority',
      ' VIP ',
    ]);
    const persistedOrderDetail = await new OrderDetailService(pool).getOrder(
      staffSession,
      orderNumber,
    );
    expect(persistedOrderDetail?.notes[0]).toMatchObject({
      body: 'Customer requested gift packaging.',
      createdByName: staffSession.email,
    });
    expect(persistedOrderDetail?.tags).toEqual(['Priority', 'VIP']);
    const firstTimelinePage = await orderDetail.listTimeline(staffSession, orderNumber, {
      limit: 10,
      page: 1,
    });
    expect(firstTimelinePage.events).toHaveLength(10);
    expect(firstTimelinePage.total).toBeGreaterThan(10);
    expect(firstTimelinePage).toMatchObject({ page: 1, limit: 10 });
    expect(firstTimelinePage.events.map((event) => event.occurredAt.getTime())).toEqual(
      [...firstTimelinePage.events]
        .map((event) => event.occurredAt.getTime())
        .sort((left, right) => right - left),
    );
    expect(firstTimelinePage.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ORDER_NOTE_ADDED',
          source: 'STAFF',
          actorName: staffSession.email,
        }),
        expect.objectContaining({ type: 'ORDER_TAGS_CHANGED', source: 'STAFF' }),
      ]),
    );
    const secondTimelinePage = await orderDetail.listTimeline(staffSession, orderNumber, {
      limit: 10,
      page: 2,
    });
    expect(secondTimelinePage).toMatchObject({ page: 2, limit: 10 });
    expect(
      secondTimelinePage.events.some((event) =>
        firstTimelinePage.events.some((firstEvent) => firstEvent.id === event.id),
      ),
    ).toBe(false);
    const item = await pool.query<{ id: string }>(
      `SELECT id FROM app.order_items WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)`,
      [orderNumber],
    );
    const cx = new CxOperationsService(pool, new FakePaymentService());
    const reprint = await cx.createReprint(account, {
      orderNumber,
      orderItemId: item.rows[0]!.id,
      reasonCode: 'DAMAGED_IN_TRANSIT',
      estimatedCostCents: 725,
    });
    await cx.approveReprint(account, reprint.id, true);
    expect(
      (
        await pool.query<{ status: string; replacement_external_order_id: string | null }>(
          `SELECT status, replacement_external_order_id FROM app.order_reprints WHERE id = $1`,
          [reprint.id],
        )
      ).rows[0],
    ).toEqual({ status: 'APPROVED', replacement_external_order_id: null });
    expect(
      (
        await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM app.order_fulfillment_groups
           WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)
             AND external_order_id IS NOT NULL`,
          [orderNumber],
        )
      ).rows[0]?.count,
    ).toBe('2');
  });

  it('hard prepress blockers cannot create a cart', async () => {
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, {
      productModelId: 'essential-dtg-tee',
      colorCode: 'black',
    });
    const preview = await pool.query<{ id: string }>(
      `INSERT INTO app.assets (project_id, asset_type, storage_key, content_type, byte_size, width, height) VALUES ($1, 'PREPRESS_PREVIEW', $2, 'image/png', 3, 30, 30) RETURNING id`,
      [project.id, `commerce/${randomBytes(5).toString('hex')}.png`],
    );
    await pool.query(
      `INSERT INTO app.prepress_runs (project_id, project_version_id, production_profile_id, status, renderer_version, idempotency_key, preview_asset_id) VALUES ($1, $2, 'development-essential-dtg-front-v1', 'BLOCKED', 'fixture', $3, $4)`,
      [
        project.id,
        project.activeVersionId,
        `blocked-${randomBytes(6).toString('hex')}`,
        preview.rows[0]?.id,
      ],
    );
    await expect(
      commerce.createCart(guest, { projectId: project.id, size: 'M', quantity: 1 }),
    ).rejects.toBeInstanceOf(CommerceValidationError);
  });
});

class NoProductionFulfillment implements FulfillmentService {
  createCalls = 0;
  submitCalls = 0;
  async syncCatalog() {
    return { blueprints: [], observedAt: new Date() };
  }
  async quoteShipping(input: ShippingQuoteRequest): Promise<NormalizedShippingQuote> {
    void input;
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
  async createOrder(): Promise<never> {
    this.createCalls += 1;
    throw new Error('Commerce must not create a fulfillment order.');
  }
  async submitProduction(): Promise<never> {
    this.submitCalls += 1;
    throw new Error('Commerce must not submit production.');
  }
  async cancelOrder(): Promise<never> {
    throw new Error('Commerce must not cancel fulfillment orders.');
  }
  async getOrderStatus() {
    return { externalOrderId: 'unused', state: 'UNKNOWN', occurredAt: null };
  }
  async verifyWebhook() {
    return { valid: false, externalEventId: null, eventName: 'unknown', normalizedPayload: {} };
  }
}

class OperationsFulfillment extends FakePrintifyFulfillmentAdapter {
  createCalls = 0;
  submitCalls = 0;
  failNextCreate = false;
  private submitGate: {
    markStarted: () => void;
    waitForRelease: Promise<void>;
  } | null = null;

  pauseNextSubmission(): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const waitForRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.submitGate = { markStarted, waitForRelease };
    return { started, release };
  }
  override async quoteShipping(): Promise<NormalizedShippingQuote> {
    return {
      method: 'Operations Ground',
      shippingCents: 500,
      currency: 'USD',
      estimatedDeliveryMinDays: 5,
      estimatedDeliveryMaxDays: 8,
      estimateKind: 'ESTIMATE',
      expiresAt: null,
    };
  }
  override async createOrder(input: Parameters<FulfillmentService['createOrder']>[0]) {
    this.createCalls += 1;
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new FulfillmentIntegrationError(
        'PROVIDER_ERROR',
        'Fixture provider is temporarily unavailable.',
      );
    }
    return super.createOrder(input);
  }
  override async submitProduction(input: Parameters<FulfillmentService['submitProduction']>[0]) {
    this.submitCalls += 1;
    const gate = this.submitGate;
    this.submitGate = null;
    if (gate) {
      gate.markStarted();
      await gate.waitForRelease;
    }
    return super.submitProduction(input);
  }
}

async function createOperationalCandidate(pool: SqlPool): Promise<void> {
  const suffix = randomBytes(7).toString('hex');
  const providerId = `ops-provider-${suffix}`;
  await pool.query(
    `INSERT INTO app.print_providers (id, adapter_type, external_id, display_name, status, development_only)
     VALUES ($1, 'PRINTIFY', $2, 'Operations fixture provider', 'ENABLED', true)`,
    [providerId, `ops-provider-${suffix}`],
  );
  const qualification = await pool.query<{ id: string }>(
    `INSERT INTO app.provider_qualifications (product_model_id, provider_id, decoration_method, qualification_status, active, technical_compatible, g3_reviewed, physical_test_status, reliability_score, destination_countries, shipping_enabled)
     VALUES ('essential-dtg-tee', $1, 'DTG', 'QUALIFIED', true, true, true, 'PASSED', 90, '["US"]'::jsonb, true) RETURNING id`,
    [providerId],
  );
  const qualificationId = qualification.rows[0]?.id as string;
  await pool.query(
    `INSERT INTO app.provider_variants (provider_id, product_variant_id, external_variant_id, available) VALUES ($1, 'essential-dtg-tee-black-M', $2, true)`,
    [providerId, `ops-variant-${suffix}`],
  );
  await pool.query(
    `INSERT INTO app.provider_profile_mappings (qualification_id, production_profile_id, derivative_requirements) VALUES ($1, 'development-essential-dtg-front-v1', '{"acceptedContentTypes":["image/png"],"targetWidthPx":3600,"targetHeightPx":4800}'::jsonb)`,
    [qualificationId],
  );
  await pool.query(
    `INSERT INTO app.provider_costs (qualification_id, base_production_cents, source) VALUES ($1, 1000, 'TEST')`,
    [qualificationId],
  );
}

async function readyProject(
  pool: SqlPool,
  identity: IdentityService,
  projects: ProjectService,
  storage: MemoryObjectStorage,
  colorCode: 'black' | 'navy' | 'white' = 'black',
) {
  const guest = await identity.createGuestSession();
  const project = await projects.create(guest, {
    productModelId: 'essential-dtg-tee',
    colorCode,
  });
  const previewKey = `commerce/${randomBytes(5).toString('hex')}.svg`;
  const preview = await pool.query<{ id: string }>(
    `INSERT INTO app.assets (project_id, asset_type, storage_key, content_type, byte_size, width, height) VALUES ($1, 'PREPRESS_PREVIEW', $2, 'image/svg+xml', $3, 1200, 1600) RETURNING id`,
    [project.id, previewKey, approvedArtwork().byteLength],
  );
  await storage.put({
    key: previewKey,
    body: approvedArtwork(),
    contentType: 'image/svg+xml',
  });
  const run = await pool.query<{ id: string }>(
    `INSERT INTO app.prepress_runs (project_id, project_version_id, production_profile_id, status, renderer_version, idempotency_key, preview_asset_id) VALUES ($1, $2, 'development-essential-dtg-front-v1', 'PASSED', 'fixture', $3, $4) RETURNING id`,
    [
      project.id,
      project.activeVersionId,
      `passed-${randomBytes(6).toString('hex')}`,
      preview.rows[0]?.id,
    ],
  );
  return {
    guest,
    projectId: project.id,
    revision: project.revision,
    previewAssetId: preview.rows[0]?.id as string,
    prepressRunId: run.rows[0]?.id as string,
  };
}

function approvedArtwork(): Uint8Array {
  return new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><path d="M260 320h680v960H260z" fill="#f6b943"/><circle cx="600" cy="800" r="190" fill="#1d4ed8"/></svg>',
  );
}

function address() {
  return {
    recipientName: 'Taylor Example',
    email: 'taylor@example.test',
    line1: '100 Main Street',
    city: 'San Francisco',
    stateCode: 'CA',
    postalCode: '94107',
    countryCode: 'US',
  };
}
