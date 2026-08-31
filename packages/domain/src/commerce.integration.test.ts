import { randomBytes } from 'node:crypto';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AssetService } from './assets.js';
import { CommerceAccessError, CommerceService, CommerceValidationError } from './commerce.js';
import { IdentityService } from './identity.js';
import { FakePaymentService, FakeTaxService } from './payments.js';
import { ProjectService } from './projects.js';
import { MockupService } from './mockups.js';
import {
  OrderOperationsAccessError,
  OrderOperationsService,
  OrderTransitionError,
} from './order-operations.js';
import { FakePrintifyFulfillmentAdapter } from './printify.js';
import { FulfillmentIntegrationError } from './fulfillment-contracts.js';
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
    expect(first.item?.mockupId).toBe(repeated.item?.mockupId);
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
    const ready = await readyProject(pool, identity, projects, storage);
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

  it('uses trusted review, fresh final routing, derivative readiness, and one idempotent production boundary', async () => {
    const ready = await readyProject(pool, identity, projects, storage);
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
      `operations-${randomBytes(8).toString('hex')}`,
    );
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
    expect(fulfillment.createCalls).toBe(0);
    expect(fulfillment.submitCalls).toBe(0);
    await expect(operations.submitProduction(ready.guest, orderNumber)).rejects.toBeInstanceOf(
      OrderOperationsAccessError,
    );
    expect(fulfillment.createCalls).toBe(0);
    expect(fulfillment.submitCalls).toBe(0);

    await pool.query(`UPDATE app.orders SET status = 'ROUTING' WHERE order_number = $1`, [
      orderNumber,
    ]);
    await expect(operations.submitProduction(account, orderNumber)).rejects.toBeInstanceOf(
      OrderTransitionError,
    );
    expect(fulfillment.createCalls).toBe(0);
    expect(fulfillment.submitCalls).toBe(0);
    await pool.query(
      `UPDATE app.orders SET status = 'READY_FOR_PRODUCTION' WHERE order_number = $1`,
      [orderNumber],
    );

    fulfillment.failNextCreate = true;
    await expect(operations.submitProduction(account, orderNumber)).rejects.toBeInstanceOf(
      FulfillmentIntegrationError,
    );
    await pool.query(
      `UPDATE app.order_fulfillment_actions
       SET status = 'PROCESSING', updated_at = now() - interval '6 minutes'
       WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)
         AND action = 'CREATE_EXTERNAL_ORDER'`,
      [orderNumber],
    );
    const gate = fulfillment.pauseNextSubmission();
    const pendingFirst = operations.submitProduction(account, orderNumber);
    await gate.started;
    await expect(operations.submitProduction(account, orderNumber)).rejects.toBeInstanceOf(
      OrderTransitionError,
    );
    await expect(
      operations.hold(account, orderNumber, 'OPERATIONAL_HOLD', 'Concurrent hold fixture.'),
    ).rejects.toBeInstanceOf(OrderTransitionError);
    gate.release();
    const first = await pendingFirst;
    const second = await operations.submitProduction(account, orderNumber);
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ externalOrderId: first.externalOrderId, duplicate: true });
    expect(fulfillment.createCalls).toBe(2);
    expect(fulfillment.submitCalls).toBe(1);
    const externalOrders = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.external_fulfillment_orders e
       JOIN app.orders o ON o.id = e.order_id WHERE o.order_number = $1`,
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
