import { randomBytes } from 'node:crypto';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AssetService } from './assets.js';
import {
  CatalogSyncService,
  FulfillmentAccessError,
  FulfillmentAdminService,
} from './fulfillment.js';
import type {
  FulfillmentService,
  NormalizedShippingQuote,
  ShippingQuoteRequest,
} from './fulfillment-contracts.js';
import { IdentityService } from './identity.js';
import { FakePrintifyFulfillmentAdapter } from './printify.js';
import { ProjectService } from './projects.js';
import { ProviderDerivativeService, FulfillmentRoutingService } from './routing.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;
const integrationSuite = integrationDatabaseUrl ? describe : describe.skip;

integrationSuite('Printify catalog and fulfillment routing integration', () => {
  let pool: SqlPool;
  let close: () => Promise<void>;

  beforeAll(() => {
    const database = createDatabaseClient(integrationDatabaseUrl as string);
    pool = database.pool;
    close = database.close;
  });

  afterAll(async () => close());

  it('synchronizes only allowlisted catalog mappings idempotently without erasing history or local provider controls', async () => {
    const sync = new CatalogSyncService(pool, new FakePrintifyFulfillmentAdapter());
    const providerId = 'printify-fake-harbor';
    const original = await pool.query<{ status: string }>(
      'SELECT status FROM app.print_providers WHERE id = $1',
      [providerId],
    );
    await pool.query(`UPDATE app.print_providers SET status = 'SUSPENDED' WHERE id = $1`, [
      providerId,
    ]);
    const key = `sync-${randomBytes(6).toString('hex')}`;
    const first = await sync.sync(key);
    const second = await sync.sync(key);
    expect(first).toMatchObject({ status: 'SUCCEEDED' });
    expect(second.id).toBe(first.id);
    expect(second.providersObserved).toBe(first.providersObserved);
    const mapping = await pool.query<{
      external_blueprint_id: string;
      external_available: boolean;
    }>(
      `SELECT external_blueprint_id, external_available FROM app.fulfillment_product_mappings
       WHERE product_model_id = 'essential-dtg-tee' AND adapter_type = 'PRINTIFY'`,
    );
    expect(mapping.rows[0]).toMatchObject({
      external_blueprint_id: 'fake-essential-dtg-tee-blueprint',
      external_available: true,
    });
    const provider = await pool.query<{ status: string }>(
      'SELECT status FROM app.print_providers WHERE id = $1',
      [providerId],
    );
    expect(provider.rows[0]?.status).toBe('SUSPENDED');
    await pool.query(`UPDATE app.print_providers SET status = $2 WHERE id = $1`, [
      providerId,
      original.rows[0]?.status ?? 'ENABLED',
    ]);
    await new CatalogSyncService(pool, new RemovedCatalogAdapter()).sync(
      `removed-${randomBytes(6).toString('hex')}`,
    );
    const preserved = await pool.query<{ external_available: boolean }>(
      `SELECT external_available FROM app.fulfillment_product_mappings
       WHERE product_model_id = 'essential-dtg-tee' AND adapter_type = 'PRINTIFY'`,
    );
    expect(preserved.rows[0]).toMatchObject({ external_available: false });
    await sync.sync(`restore-${randomBytes(6).toString('hex')}`);
  });

  it('keeps development provider combinations explicitly unqualified', async () => {
    const result = await pool.query<{
      qualification_status: string;
      g3_reviewed: boolean;
      physical_test_status: string;
    }>(
      `SELECT qualification_status, g3_reviewed, physical_test_status FROM app.provider_qualifications
       WHERE provider_id LIKE 'printify-fake-%'`,
    );
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          qualification_status: 'UNQUALIFIED',
          g3_reviewed: false,
          physical_test_status: 'NOT_TESTED',
        }),
      ]),
    );
  });

  it('excludes unqualified, disabled, suspended, unavailable, unsupported, and profile-less candidates with structured reasons', async () => {
    const adapter = new TestFulfillmentAdapter();
    const routing = new FulfillmentRoutingService(pool, adapter);
    const candidates = await Promise.all([
      createCandidate(pool, { qualificationStatus: 'UNQUALIFIED' }),
      createCandidate(pool, { providerStatus: 'DISABLED' }),
      createCandidate(pool, { providerStatus: 'SUSPENDED' }),
      createCandidate(pool, { variantAvailable: false }),
      createCandidate(pool, { destinationCountries: ['CA'] }),
      createCandidate(pool, { shippingEnabled: false }),
      createCandidate(pool, { profile: false }),
    ]);
    const decision = await routing.evaluate(routingInput());
    const byId = new Map(
      decision.candidates.map((candidate) => [candidate.qualificationId, candidate]),
    );
    expect(byId.get(candidates[0]!.qualificationId)?.exclusions).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'QUALIFICATION_NOT_APPROVED' })]),
    );
    expect(byId.get(candidates[1]!.qualificationId)?.exclusions).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PROVIDER_DISABLED' })]),
    );
    expect(byId.get(candidates[2]!.qualificationId)?.exclusions).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PROVIDER_SUSPENDED' })]),
    );
    expect(byId.get(candidates[3]!.qualificationId)?.exclusions).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'VARIANT_UNAVAILABLE' })]),
    );
    expect(byId.get(candidates[4]!.qualificationId)?.exclusions).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DESTINATION_UNSUPPORTED' })]),
    );
    expect(byId.get(candidates[5]!.qualificationId)?.exclusions).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SHIPPING_UNAVAILABLE' })]),
    );
    expect(byId.get(candidates[6]!.qualificationId)?.exclusions).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PRODUCTION_PROFILE_UNAVAILABLE' })]),
    );
  });

  it('protects margin and landed-cost ceilings, then ranks quality before cheaper cost deterministically', async () => {
    const adapter = new TestFulfillmentAdapter();
    const routing = new FulfillmentRoutingService(pool, adapter);
    const expensive = await createCandidate(pool, { costCents: 2300, shippingCents: 600 });
    const lowQualityCheap = await createCandidate(pool, {
      costCents: 900,
      shippingCents: 400,
      reliabilityScore: 40,
    });
    const highQualityCostlier = await createCandidate(pool, {
      costCents: 1100,
      shippingCents: 500,
      reliabilityScore: 90,
    });
    const decision = await routing.evaluate(routingInput({ retailPriceCents: 3200 }));
    const expensiveResult = decision.candidates.find(
      (candidate) => candidate.qualificationId === expensive.qualificationId,
    );
    expect(expensiveResult?.exclusions).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'LANDED_COST_ABOVE_CEILING' })]),
    );
    const low = decision.candidates.find(
      (candidate) => candidate.qualificationId === lowQualityCheap.qualificationId,
    );
    const high = decision.candidates.find(
      (candidate) => candidate.qualificationId === highQualityCostlier.qualificationId,
    );
    expect(high?.ranking?.total).toBeGreaterThan(low?.ranking?.total as number);
    expect(decision.selectedQualificationId).toBe(highQualityCostlier.qualificationId);
    const repeat = await routing.evaluate(routingInput({ retailPriceCents: 3200 }));
    expect(repeat.selectedQualificationId).toBe(decision.selectedQualificationId);
    const persisted = await pool.query<{ request_snapshot: unknown; decision_snapshot: unknown }>(
      `SELECT request_snapshot, decision_snapshot FROM app.routing_evaluations WHERE id = $1`,
      [decision.id],
    );
    expect(persisted.rows[0]?.decision_snapshot).toMatchObject({
      selectedQualificationId: decision.selectedQualificationId,
    });
  });

  it('uses normalized shipping quotes and allows a Milestone 4 prepress result to feed eligibility', async () => {
    const adapter = new TestFulfillmentAdapter();
    const candidate = await createCandidate(pool, { costCents: 1000, shippingCents: 500 });
    const prepress = await createPrepressMaster(pool);
    const routing = new FulfillmentRoutingService(pool, adapter);
    const decision = await routing.evaluate(routingInput({ prepressRunId: prepress.runId }));
    const result = decision.candidates.find(
      (entry) => entry.qualificationId === candidate.qualificationId,
    );
    expect(result).toMatchObject({
      eligible: true,
      shippingQuote: { method: 'Fixture Ground', estimateKind: 'ESTIMATE' },
    });
    expect(result?.exclusions.map((exclusion) => exclusion.code)).not.toContain(
      'PREPRESS_NOT_READY',
    );
    const quote = await pool.query<{
      method: string;
      shipping_cents: number;
      estimate_kind: string;
    }>(
      `SELECT method, shipping_cents, estimate_kind FROM app.shipping_quotes WHERE qualification_id = $1 ORDER BY quoted_at DESC LIMIT 1`,
      [candidate.qualificationId],
    );
    expect(quote.rows[0]).toMatchObject({
      method: 'Fixture Ground',
      shipping_cents: 500,
      estimate_kind: 'ESTIMATE',
    });
  });

  it('creates a backend-only provider derivative with production-master lineage', async () => {
    const candidate = await createCandidate(pool, { costCents: 1000, shippingCents: 500 });
    const prepress = await createPrepressMaster(pool);
    const storage = new MemoryObjectStorage();
    await storage.put({
      key: prepress.storageKey,
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    });
    const derivatives = new ProviderDerivativeService(pool, storage);
    const result = await derivatives.create({
      prepressRunId: prepress.runId,
      qualificationId: candidate.qualificationId,
    });
    expect(result.status).toBe('READY');
    const lineage = await pool.query<{ relationship: string }>(
      `SELECT relationship FROM app.asset_lineage WHERE derived_asset_id = $1`,
      [result.derivativeAssetId],
    );
    expect(lineage.rows[0]?.relationship).toBe('PROVIDER_DERIVATIVE_SOURCE');
    const assetService = new AssetService(pool);
    expect(
      await assetService.getControlledPreview(
        prepress.guest,
        prepress.projectId,
        result.derivativeAssetId as string,
      ),
    ).toBeNull();
  });

  it('protects provider economics and controls from consumers while allowing an operationally assigned admin', async () => {
    const identity = new IdentityService(pool);
    const admin = new FulfillmentAdminService(pool);
    const guest = await identity.createGuestSession();
    await expect(admin.listProviderMatrix(guest)).rejects.toBeInstanceOf(FulfillmentAccessError);
    const user = await identity.register(
      guest,
      `ops-${randomBytes(5).toString('hex')}@example.test`,
      'safe-password-123',
    );
    await expect(admin.listProviderMatrix(user)).rejects.toBeInstanceOf(FulfillmentAccessError);
    await pool.query(`UPDATE app.users SET role = 'FULFILLMENT_ADMIN' WHERE id = $1`, [
      user.userId,
    ]);
    await expect(admin.listProviderMatrix(user)).resolves.toEqual(expect.any(Array));
  });

  it('ingests validated fulfillment events idempotently', async () => {
    const sync = new CatalogSyncService(pool, new FakePrintifyFulfillmentAdapter());
    const event = {
      id: `fake-event-${randomBytes(5).toString('hex')}`,
      type: 'catalog:updated',
      status: 'ok',
    };
    const input = { body: JSON.stringify(event), signature: 'fake-valid-signature' };
    expect(await sync.ingestWebhook(input)).toEqual({ duplicate: false });
    expect(await sync.ingestWebhook(input)).toEqual({ duplicate: true });
  });
});

class TestFulfillmentAdapter implements FulfillmentService {
  async syncCatalog() {
    return { blueprints: [], observedAt: new Date() };
  }

  async quoteShipping(input: ShippingQuoteRequest): Promise<NormalizedShippingQuote> {
    const shippingCents = Number(input.externalProviderId.split('-').at(-1)) || 500;
    return {
      method: 'Fixture Ground',
      shippingCents,
      currency: 'USD',
      estimatedDeliveryMinDays: 4,
      estimatedDeliveryMaxDays: 6,
      estimateKind: 'ESTIMATE',
      expiresAt: null,
    };
  }

  async createOrder() {
    return { externalOrderId: 'fixture-order', state: 'CREATED' as const };
  }

  async submitProduction(): Promise<void> {}

  async getOrderStatus() {
    return { externalOrderId: 'fixture-order', state: 'UNKNOWN', occurredAt: null };
  }

  async verifyWebhook() {
    return {
      valid: true,
      externalEventId: 'fixture-event',
      eventName: 'fixture',
      normalizedPayload: {},
    };
  }
}

class RemovedCatalogAdapter extends TestFulfillmentAdapter {
  override async syncCatalog() {
    return { blueprints: [], observedAt: new Date() };
  }
}

async function createCandidate(
  pool: SqlPool,
  input: {
    qualificationStatus?: 'UNQUALIFIED' | 'QUALIFIED';
    providerStatus?: 'ENABLED' | 'SUSPENDED' | 'DISABLED';
    variantAvailable?: boolean;
    destinationCountries?: string[];
    shippingEnabled?: boolean;
    profile?: boolean;
    costCents?: number;
    shippingCents?: number;
    reliabilityScore?: number;
  } = {},
) {
  const suffix = randomBytes(7).toString('hex');
  const providerId = `fixture-provider-${suffix}`;
  const qualificationId = await pool.query<{ id: string }>(
    `INSERT INTO app.print_providers (id, adapter_type, external_id, display_name, status, development_only)
     VALUES ($1, 'PRINTIFY', $2, 'Fixture provider', $3, false)`,
    [
      providerId,
      `fixture-${input.shippingCents ?? 500}-${suffix}`,
      input.providerStatus ?? 'ENABLED',
    ],
  );
  void qualificationId;
  const qualification = await pool.query<{ id: string }>(
    `INSERT INTO app.provider_qualifications (
       product_model_id, provider_id, decoration_method, qualification_status, active, technical_compatible,
       g3_reviewed, physical_test_status, reliability_score, destination_countries, shipping_enabled
     ) VALUES ('essential-dtg-tee', $1, 'DTG', $2, true, true, $3, $4, $5, $6::jsonb, $7)
     RETURNING id`,
    [
      providerId,
      input.qualificationStatus ?? 'QUALIFIED',
      input.qualificationStatus === 'UNQUALIFIED' ? false : true,
      input.qualificationStatus === 'UNQUALIFIED' ? 'NOT_TESTED' : 'PASSED',
      input.reliabilityScore ?? 80,
      JSON.stringify(input.destinationCountries ?? ['US']),
      input.shippingEnabled ?? true,
    ],
  );
  const id = qualification.rows[0]?.id as string;
  await pool.query(
    `INSERT INTO app.provider_variants (provider_id, product_variant_id, external_variant_id, available)
     VALUES ($1, 'essential-dtg-tee-black-M', $2, $3)`,
    [providerId, `fixture-variant-${suffix}`, input.variantAvailable ?? true],
  );
  await pool.query(
    `INSERT INTO app.provider_costs (
       qualification_id, base_production_cents, variant_cents, decoration_cents, provider_fee_cents, currency, source
     ) VALUES ($1, $2, 0, 0, 0, 'USD', 'TEST')`,
    [id, input.costCents ?? 1000],
  );
  if (input.profile ?? true) {
    const profileId = `fixture-profile-${suffix}`;
    await pool.query(
      `INSERT INTO app.production_profiles (
         id, product_model_id, provider_id, decoration_method, qualification_status, profile_data, development_only
       ) VALUES ($1, 'essential-dtg-tee', $2, 'DTG', 'APPROVED', $3::jsonb, false)`,
      [profileId, providerId, JSON.stringify(profile())],
    );
    await pool.query(
      `INSERT INTO app.provider_profile_mappings (qualification_id, production_profile_id, derivative_requirements)
       VALUES ($1, $2, '{"acceptedContentTypes":["image/png"],"targetWidthPx":3600,"targetHeightPx":4800}'::jsonb)`,
      [id, profileId],
    );
  }
  return { providerId, qualificationId: id };
}

async function createPrepressMaster(pool: SqlPool) {
  const identity = new IdentityService(pool);
  const projects = new ProjectService(pool);
  const guest = await identity.createGuestSession();
  const project = await projects.create(guest, {
    productModelId: 'essential-dtg-tee',
    colorCode: 'black',
  });
  const storageKey = `fixtures/${randomBytes(7).toString('hex')}.png`;
  const master = await pool.query<{ id: string }>(
    `INSERT INTO app.assets (project_id, asset_type, storage_key, content_type, byte_size, width, height)
     VALUES ($1, 'PRODUCTION_MASTER', $2, 'image/png', 3, 3600, 4800) RETURNING id`,
    [project.id, storageKey],
  );
  const run = await pool.query<{ id: string }>(
    `INSERT INTO app.prepress_runs (
       project_id, project_version_id, production_profile_id, status, renderer_version, idempotency_key, production_master_asset_id
     ) VALUES ($1, $2, 'development-essential-dtg-front-v1', 'PASSED', 'fixture', $3, $4) RETURNING id`,
    [
      project.id,
      project.activeVersionId,
      `fixture-prepress-${randomBytes(7).toString('hex')}`,
      master.rows[0]?.id,
    ],
  );
  return { guest, projectId: project.id, runId: run.rows[0]?.id as string, storageKey };
}

function routingInput(
  overrides: Partial<{ retailPriceCents: number; prepressRunId: string }> = {},
) {
  return {
    productModelId: 'essential-dtg-tee',
    productVariantId: 'essential-dtg-tee-black-M',
    destinationCountry: 'US',
    retailPriceCents: 3200,
    ...overrides,
  };
}

function profile() {
  return {
    physicalWidthInches: 12,
    physicalHeightInches: 16,
    targetWidthPx: 3600,
    targetHeightPx: 4800,
    targetDpi: 300,
    dpiWarningThreshold: 200,
    dpiBlockThreshold: 120,
    safeBounds: { x: 0.056, y: 0.078, width: 0.888, height: 0.844 },
    allowedFormats: ['png'],
    requiresTransparency: true,
  };
}
