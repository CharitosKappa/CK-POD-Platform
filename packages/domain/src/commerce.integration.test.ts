import { randomBytes } from 'node:crypto';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import { integrityViolationCounts } from '@let-it-be/db/integrity';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AssetService } from './assets.js';
import { CommerceAccessError, CommerceService, CommerceValidationError } from './commerce.js';
import { IdentityService } from './identity.js';
import { FakePaymentService, FakeTaxService } from './payments.js';
import { ProjectService } from './projects.js';
import { MockupService } from './mockups.js';
import { CxOperationsService } from './operations-analytics.js';
import {
  OrderOperationsAccessError,
  OrderOperationsService,
  OrderTransitionError,
} from './order-operations.js';
import { FakePrintifyFulfillmentAdapter } from './printify.js';
import { FulfillmentIntegrationError } from './fulfillment-contracts.js';
import type { PaymentService } from './commerce-contracts.js';
import type {
  FulfillmentService,
  NormalizedShippingQuote,
  ShippingQuoteRequest,
} from './fulfillment-contracts.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;
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
    expect(paid).toMatchObject({ duplicate: false, orderNumber: expect.stringMatching(/^LIB-/) });
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
    }>(
      `SELECT shipping_address_snapshot, billing_address_snapshot FROM app.orders WHERE order_number = $1`,
      [paid.orderNumber],
    );
    expect(addressSnapshots.rows[0]?.billing_address_snapshot).toEqual(
      addressSnapshots.rows[0]?.shipping_address_snapshot,
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

    expect(paid.orderNumber).toMatch(/^LIB-/);
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
    const payment = {
      refund: vi.fn().mockResolvedValue({ providerRefundId: `refund-${orderNumber}` }),
    } as unknown as PaymentService;
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
    expect(payment.refund).toHaveBeenCalledTimes(1);
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
    const fulfillment = new OperationsFulfillment();
    const operations = new OrderOperationsService(pool, storage, fulfillment, {
      fulfillmentAdapter: 'fake',
      realProductionSubmissionEnabled: false,
    });

    await expect(operations.listFulfillmentGroups(ready.guest, orderNumber)).rejects.toBeInstanceOf(
      OrderOperationsAccessError,
    );
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
    await operations.startPrepressReview(account, orderNumber);
    await operations.decideReview(account, {
      orderNumber,
      stage: 'PREPRESS',
      outcome: 'APPROVED',
      reasonCode: 'PRINTABILITY_CONCERN',
    });
    await operations.decideReview(account, {
      orderNumber,
      stage: 'COMPLIANCE',
      outcome: 'APPROVED',
      reasonCode: 'MODERATION_REVIEW',
    });
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe(
      'READY_FOR_PRODUCTION',
    );
    // The current order-wide routing workflow precedes group routing. For this
    // group-action test, bind the group to the qualification already approved
    // by that workflow; the next slice will make this selection per group.
    await pool.query(
      `UPDATE app.order_fulfillment_groups
       SET qualification_id = (
         SELECT selected_qualification_id FROM app.order_final_routing
         WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)
         ORDER BY created_at DESC LIMIT 1
       )
       WHERE id = $2`,
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
      operations.submitFulfillmentGroup(account, { orderNumber, fulfillmentGroupId }),
    ).rejects.toBeInstanceOf(OrderTransitionError);
    expect(fulfillment.createCalls).toBe(0);
    expect(fulfillment.submitCalls).toBe(0);
    await pool.query(
      `UPDATE app.orders SET status = 'READY_FOR_PRODUCTION' WHERE order_number = $1`,
      [orderNumber],
    );

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
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe('IN_PRODUCTION');
    await operations.reconcileStatus({
      externalOrderId: first.externalOrderId,
      rawStatus: 'shipped',
      source: 'POLLING',
    });
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe('SHIPPED');
    await operations.reconcileStatus({
      externalOrderId: first.externalOrderId,
      rawStatus: 'delivered',
      source: 'WEBHOOK',
      externalEventId: `ops-delivered-${randomBytes(5).toString('hex')}`,
    });
    expect((await commerce.getOrder(ready.guest, orderNumber))?.status).toBe('DELIVERED');
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
    ).toBe('1');
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
