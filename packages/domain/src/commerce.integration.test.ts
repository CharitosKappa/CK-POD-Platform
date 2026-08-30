import { randomBytes } from 'node:crypto';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CommerceAccessError, CommerceService, CommerceValidationError } from './commerce.js';
import { IdentityService } from './identity.js';
import { FakePaymentService, FakeTaxService } from './payments.js';
import { ProjectService } from './projects.js';
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

  beforeAll(() => {
    const database = createDatabaseClient(integrationDatabaseUrl as string);
    pool = database.pool;
    close = database.close;
    identity = new IdentityService(pool);
    projects = new ProjectService(pool);
    fulfillment = new NoProductionFulfillment();
    commerce = new CommerceService(
      pool,
      new FakePaymentService(),
      new FakeTaxService(875),
      fulfillment,
    );
  });

  afterAll(async () => close());

  it('creates an owned cart from a passed canonical project, persists variant/quantity, and produces a controlled proof', async () => {
    const ready = await readyProject(pool, identity, projects);
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
    });
    expect(cart.proofApproved).toBe(false);
    await expect(
      commerce.getCart(await identity.createGuestSession(), cart.id),
    ).rejects.toBeInstanceOf(CommerceAccessError);
    const mockup = await pool.query<{ preview_asset_id: string }>(
      'SELECT preview_asset_id FROM app.mockups WHERE id = $1',
      [cart.item?.mockupId],
    );
    expect(mockup.rows[0]?.preview_asset_id).toBe(ready.previewAssetId);
  });

  it('invalidates a proof when the project version changes', async () => {
    const ready = await readyProject(pool, identity, projects);
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

  it('uses server-owned minor-unit pricing, configurable quantity discount/free shipping, and validated addresses', async () => {
    const ready = await readyProject(pool, identity, projects);
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
    const checkout = await commerce.startCheckout(
      ready.guest,
      cart.id,
      addressId,
      `checkout-${randomBytes(8).toString('hex')}`,
    );
    expect(checkout.pricing).toMatchObject({
      unitRetailCents: 2900,
      quantity: 3,
      discountCents: 870,
      subtotalCents: 7830,
      customerShippingCents: 0,
      freeShippingApplied: true,
      taxCents: 685,
      totalCents: 8515,
    });
    expect(checkout.shipping).toMatchObject({
      provisional: true,
      providerShippingCostCents: 550,
      customerShippingCents: 0,
    });
    expect(checkout.tax).toMatchObject({ provider: 'FAKE', taxableSubtotalCents: 7830 });
  });

  it('supports safe guest checkout, verified idempotent payment events, and canonical PAID order state only', async () => {
    const ready = await readyProject(pool, identity, projects);
    const cart = await commerce.createCart(ready.guest, {
      projectId: ready.projectId,
      size: 'M',
      quantity: 1,
    });
    await commerce.approveProof(ready.guest, cart.id);
    const addressId = await commerce.saveShippingAddress(ready.guest, cart.id, address());
    const checkout = await commerce.startCheckout(
      ready.guest,
      cart.id,
      addressId,
      `checkout-${randomBytes(8).toString('hex')}`,
    );
    const paid = await commerce.simulateFakePayment(ready.guest, checkout.id, 'SUCCEEDED');
    const repeated = await commerce.simulateFakePayment(ready.guest, checkout.id, 'SUCCEEDED');
    expect(paid).toMatchObject({ duplicate: false, orderNumber: expect.stringMatching(/^LIB-/) });
    expect(repeated).toEqual({ duplicate: true, orderNumber: paid.orderNumber });
    const order = await commerce.getOrder(ready.guest, paid.orderNumber as string);
    expect(order).toMatchObject({ status: 'PAID' });
    expect(fulfillment.createCalls).toBe(0);
    expect(fulfillment.submitCalls).toBe(0);
    await expect(
      commerce.getOrder(await identity.createGuestSession(), paid.orderNumber as string),
    ).resolves.toBeNull();
  });

  it('preserves guest cart and order ownership when the guest becomes an account', async () => {
    const ready = await readyProject(pool, identity, projects);
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

async function readyProject(pool: SqlPool, identity: IdentityService, projects: ProjectService) {
  const guest = await identity.createGuestSession();
  const project = await projects.create(guest, {
    productModelId: 'essential-dtg-tee',
    colorCode: 'black',
  });
  const preview = await pool.query<{ id: string }>(
    `INSERT INTO app.assets (project_id, asset_type, storage_key, content_type, byte_size, width, height) VALUES ($1, 'PREPRESS_PREVIEW', $2, 'image/png', 3, 30, 30) RETURNING id`,
    [project.id, `commerce/${randomBytes(5).toString('hex')}.png`],
  );
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
