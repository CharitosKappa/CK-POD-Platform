import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import type { ActiveSession } from './identity';
import {
  normalizeFulfillmentError,
  type FulfillmentAdapterType,
  type FulfillmentService,
  type NormalizedShippingQuote,
} from './fulfillment-contracts';

const adapterType: FulfillmentAdapterType = 'PRINTIFY';

export class FulfillmentAccessError extends Error {}

export interface CatalogSyncSummary {
  id: string;
  status: 'SUCCEEDED' | 'FAILED';
  providersObserved: number;
  variantsObserved: number;
  attempts: number;
}

export interface ProviderMatrixRow {
  qualificationId: string;
  productModelId: string;
  productName: string;
  providerId: string;
  providerName: string;
  providerStatus: 'ENABLED' | 'SUSPENDED' | 'DISABLED';
  decorationMethod: string;
  qualificationStatus: 'UNQUALIFIED' | 'UNDER_REVIEW' | 'QUALIFIED' | 'SUSPENDED' | 'REJECTED';
  active: boolean;
  technicalCompatible: boolean;
  g3Reviewed: boolean;
  physicalTestStatus: 'NOT_TESTED' | 'PENDING' | 'PASSED' | 'FAILED';
  reliabilityScore: number;
  productionProfileId: string | null;
  shippingEnabled: boolean;
  lastSyncedAt: Date | null;
  routingNotes: string | null;
  qualificationNotes: string | null;
  currentCostCents: number | null;
}

interface SyncRunRow {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  attempt_count: number;
  summary: Record<string, unknown>;
}

interface MappingRow {
  product_model_id: string;
  external_blueprint_id: string;
}

interface VariantMappingRow {
  product_variant_id: string;
  external_variant_id: string;
}

interface ProviderRow {
  id: string;
  external_id: string;
}

interface MatrixRow extends ProviderMatrixRow {
  product_name: string;
  provider_name: string;
  provider_status: ProviderMatrixRow['providerStatus'];
  qualification_id: string;
  product_model_id: string;
  provider_id: string;
  decoration_method: string;
  qualification_status: ProviderMatrixRow['qualificationStatus'];
  technical_compatible: boolean;
  g3_reviewed: boolean;
  physical_test_status: ProviderMatrixRow['physicalTestStatus'];
  reliability_score: number;
  production_profile_id: string | null;
  shipping_enabled: boolean;
  last_synced_at: Date | null;
  routing_notes: string | null;
  qualification_notes: string | null;
  current_cost_cents: number | null;
}

/** Persists only allowlisted external catalog data. Normal page rendering never invokes this. */
export class CatalogSyncService {
  public constructor(
    private readonly pool: SqlPool,
    private readonly fulfillment: FulfillmentService,
  ) {}

  async sync(idempotencyKey: string): Promise<CatalogSyncSummary> {
    const existing = await this.pool.query<SyncRunRow>(
      `SELECT id, status, attempt_count, summary FROM app.catalog_sync_runs WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    if (existing.rows[0]?.status === 'SUCCEEDED') return mapSyncSummary(existing.rows[0]);

    const run = await this.pool.query<SyncRunRow>(
      `INSERT INTO app.catalog_sync_runs (adapter_type, status, idempotency_key, started_at)
       VALUES ($1, 'RUNNING', $2, now())
       ON CONFLICT (idempotency_key) DO UPDATE
         SET status = 'RUNNING', started_at = now(), failure_category = NULL, failure_detail = NULL
       RETURNING id, status, attempt_count, summary`,
      [adapterType, idempotencyKey],
    );
    const row = requireRow(run.rows[0], 'Could not start catalog synchronization.');
    await recordOperationalEvent(this.pool, 'catalog_sync_started', {});

    let attempt = 0;
    try {
      const mappings = await this.pool.query<MappingRow>(
        `SELECT product_model_id, external_blueprint_id FROM app.fulfillment_product_mappings
         WHERE adapter_type = $1 AND allowlisted = true`,
        [adapterType],
      );
      let snapshot;
      do {
        attempt += 1;
        try {
          snapshot = await this.fulfillment.syncCatalog({
            externalBlueprintIds: mappings.rows.map((mapping) => mapping.external_blueprint_id),
          });
          break;
        } catch (error) {
          const normalized = normalizeFulfillmentError(error);
          if (!normalized.retryable || attempt >= 2) throw normalized;
        }
      } while (!snapshot);
      const summary = await withTransaction(this.pool, async (client) => {
        const total = { providersObserved: 0, variantsObserved: 0 };
        await client.query(
          `UPDATE app.print_providers SET external_available = false, updated_at = now()
           WHERE adapter_type = $1`,
          [adapterType],
        );
        await client.query(
          `UPDATE app.fulfillment_product_mappings SET external_available = false, updated_at = now()
           WHERE adapter_type = $1 AND allowlisted = true`,
          [adapterType],
        );
        for (const blueprint of snapshot!.blueprints) {
          const mapping = mappings.rows.find(
            (candidate) => candidate.external_blueprint_id === blueprint.externalBlueprintId,
          );
          if (!mapping) continue;
          await client.query(
            `UPDATE app.fulfillment_product_mappings
             SET external_available = $1, external_metadata = $2::jsonb, last_synced_at = $3, updated_at = now()
             WHERE product_model_id = $4 AND adapter_type = $5`,
            [
              blueprint.available,
              JSON.stringify({ displayName: blueprint.displayName }),
              snapshot!.observedAt,
              mapping.product_model_id,
              adapterType,
            ],
          );
          const variants = await client.query<VariantMappingRow>(
            `SELECT product_variant_id, external_variant_id FROM app.fulfillment_variant_mappings
             WHERE adapter_type = $1 AND product_variant_id IN (
               SELECT id FROM app.product_variants WHERE product_model_id = $2
             )`,
            [adapterType, mapping.product_model_id],
          );
          for (const externalProvider of blueprint.providers) {
            const provider = await upsertProvider(client, externalProvider, snapshot!.observedAt);
            total.providersObserved += 1;
            await client.query(
              `UPDATE app.provider_variants SET available = false, last_synced_at = $1 WHERE provider_id = $2`,
              [snapshot!.observedAt, provider.id],
            );
            for (const externalVariant of externalProvider.variants) {
              const variant = variants.rows.find(
                (candidate) => candidate.external_variant_id === externalVariant.externalVariantId,
              );
              if (!variant) continue;
              await client.query(
                `INSERT INTO app.provider_variants (
                   provider_id, product_variant_id, external_variant_id, available, external_metadata, last_synced_at
                 ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
                 ON CONFLICT (provider_id, product_variant_id) DO UPDATE
                   SET external_variant_id = EXCLUDED.external_variant_id, available = EXCLUDED.available,
                       external_metadata = EXCLUDED.external_metadata, last_synced_at = EXCLUDED.last_synced_at`,
                [
                  provider.id,
                  variant.product_variant_id,
                  externalVariant.externalVariantId,
                  externalVariant.available,
                  JSON.stringify({ source: 'catalog-sync' }),
                  snapshot!.observedAt,
                ],
              );
              total.variantsObserved += 1;
            }
          }
        }
        const syncSummary = { ...total, attempts: attempt };
        await client.query(
          `UPDATE app.catalog_sync_runs
           SET status = 'SUCCEEDED', attempt_count = $2, summary = $3::jsonb, completed_at = now()
           WHERE id = $1`,
          [row.id, attempt, JSON.stringify(syncSummary)],
        );
        return syncSummary;
      });
      await recordOperationalEvent(this.pool, 'catalog_sync_succeeded', summary);
      return { id: row.id, status: 'SUCCEEDED', ...summary };
    } catch (error) {
      const normalized = normalizeFulfillmentError(error);
      await this.pool.query(
        `UPDATE app.catalog_sync_runs
         SET status = 'FAILED', attempt_count = $2, failure_category = $3, failure_detail = $4, completed_at = now()
         WHERE id = $1`,
        [row.id, attempt, normalized.code, normalized.message],
      );
      await recordOperationalEvent(this.pool, 'catalog_sync_failed', { code: normalized.code });
      throw normalized;
    }
  }

  async quoteAndPersist(input: {
    providerId: string;
    productVariantId: string;
    destinationCountry: string;
    qualificationId?: string;
  }): Promise<NormalizedShippingQuote> {
    const result = await this.pool.query<{
      external_provider_id: string;
      external_blueprint_id: string;
      external_variant_id: string;
    }>(
      `SELECT p.external_id AS external_provider_id, pm.external_blueprint_id, pv.external_variant_id
       FROM app.print_providers p
       JOIN app.provider_variants pv ON pv.provider_id = p.id
       JOIN app.fulfillment_product_mappings pm ON pm.adapter_type = p.adapter_type
       JOIN app.product_variants v ON v.id = pv.product_variant_id AND v.product_model_id = pm.product_model_id
       WHERE p.id = $1 AND pv.product_variant_id = $2 AND p.adapter_type = $3`,
      [input.providerId, input.productVariantId, adapterType],
    );
    const mapping = requireRow(result.rows[0], 'Provider variant mapping is unavailable.');
    const quote = await this.fulfillment.quoteShipping({
      externalProviderId: mapping.external_provider_id,
      externalBlueprintId: mapping.external_blueprint_id,
      externalVariantId: mapping.external_variant_id,
      destinationCountry: input.destinationCountry,
    });
    await this.pool.query(
      `INSERT INTO app.shipping_quotes (
         provider_id, qualification_id, destination_country, method, shipping_cents, currency,
         estimated_delivery_min_days, estimated_delivery_max_days, estimate_kind, quoted_at, expires_at, source
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11)`,
      [
        input.providerId,
        input.qualificationId ?? null,
        input.destinationCountry,
        quote.method,
        quote.shippingCents,
        quote.currency,
        quote.estimatedDeliveryMinDays,
        quote.estimatedDeliveryMaxDays,
        quote.estimateKind,
        quote.expiresAt,
        'ADAPTER',
      ],
    );
    await recordOperationalEvent(
      this.pool,
      'shipping_quote_received',
      {
        destinationCountry: input.destinationCountry,
      },
      input.providerId,
    );
    return quote;
  }

  async ingestWebhook(input: {
    body: string;
    signature: string | null;
  }): Promise<{ duplicate: boolean }> {
    const verified = await this.fulfillment.verifyWebhook(input);
    if (!verified.valid) throw new FulfillmentAccessError('Webhook signature is invalid.');
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO app.fulfillment_events (
         adapter_type, external_event_id, event_name, status, normalized_payload, processed_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, now())
       ON CONFLICT (adapter_type, external_event_id) DO NOTHING
       RETURNING id`,
      [
        adapterType,
        verified.externalEventId,
        verified.eventName,
        verified.eventName === 'unknown' ? 'UNKNOWN' : 'PROCESSED',
        JSON.stringify(verified.normalizedPayload),
      ],
    );
    return { duplicate: !inserted.rows[0] };
  }
}

/** Trusted-only matrix and override foundation. Role assignment is operational, not consumer-facing. */
export class FulfillmentAdminService {
  public constructor(private readonly pool: SqlPool) {}

  async listProviderMatrix(session: ActiveSession): Promise<ProviderMatrixRow[]> {
    await this.requireAdmin(session);
    const result = await this.pool.query<MatrixRow>(
      `SELECT q.id AS qualification_id, q.product_model_id, m.display_name AS product_name,
              q.provider_id, p.display_name AS provider_name, p.status AS provider_status,
              q.decoration_method, q.qualification_status, q.active, q.technical_compatible,
              q.g3_reviewed, q.physical_test_status, q.reliability_score,
              ppm.production_profile_id, q.shipping_enabled, p.last_synced_at,
              q.routing_notes, q.qualification_notes,
              (c.base_production_cents + c.variant_cents + c.decoration_cents + c.provider_fee_cents) AS current_cost_cents
       FROM app.provider_qualifications q
       JOIN app.product_models m ON m.id = q.product_model_id
       JOIN app.print_providers p ON p.id = q.provider_id
       LEFT JOIN app.provider_profile_mappings ppm ON ppm.qualification_id = q.id
       LEFT JOIN app.provider_costs c ON c.qualification_id = q.id AND c.is_current
       ORDER BY m.display_name, p.display_name, q.decoration_method`,
    );
    return result.rows.map((row) => ({
      qualificationId: row.qualification_id,
      productModelId: row.product_model_id,
      productName: row.product_name,
      providerId: row.provider_id,
      providerName: row.provider_name,
      providerStatus: row.provider_status,
      decorationMethod: row.decoration_method,
      qualificationStatus: row.qualification_status,
      active: row.active,
      technicalCompatible: row.technical_compatible,
      g3Reviewed: row.g3_reviewed,
      physicalTestStatus: row.physical_test_status,
      reliabilityScore: row.reliability_score,
      productionProfileId: row.production_profile_id,
      shippingEnabled: row.shipping_enabled,
      lastSyncedAt: row.last_synced_at,
      routingNotes: row.routing_notes,
      qualificationNotes: row.qualification_notes,
      currentCostCents: row.current_cost_cents,
    }));
  }

  async updateQualification(
    session: ActiveSession,
    input: {
      qualificationId: string;
      qualificationStatus?: ProviderMatrixRow['qualificationStatus'];
      active?: boolean;
      reliabilityScore?: number;
      routingNotes?: string;
      qualificationNotes?: string;
      g3Reviewed?: boolean;
      physicalTestStatus?: ProviderMatrixRow['physicalTestStatus'];
    },
  ): Promise<void> {
    await this.requireAdmin(session);
    await this.pool.query(
      `UPDATE app.provider_qualifications
       SET qualification_status = COALESCE($2, qualification_status), active = COALESCE($3, active),
           reliability_score = COALESCE($4, reliability_score), routing_notes = COALESCE($5, routing_notes),
           qualification_notes = COALESCE($6, qualification_notes), g3_reviewed = COALESCE($7, g3_reviewed),
           physical_test_status = COALESCE($8, physical_test_status), updated_at = now()
       WHERE id = $1`,
      [
        input.qualificationId,
        input.qualificationStatus ?? null,
        input.active ?? null,
        input.reliabilityScore ?? null,
        input.routingNotes ?? null,
        input.qualificationNotes ?? null,
        input.g3Reviewed ?? null,
        input.physicalTestStatus ?? null,
      ],
    );
  }

  async setProviderStatus(
    session: ActiveSession,
    providerId: string,
    status: ProviderMatrixRow['providerStatus'],
  ): Promise<void> {
    await this.requireAdmin(session);
    await this.pool.query(
      `UPDATE app.print_providers SET status = $2, updated_at = now() WHERE id = $1`,
      [providerId, status],
    );
    await recordOperationalEvent(this.pool, 'provider_status_changed', { status }, providerId);
  }

  private async requireAdmin(session: ActiveSession): Promise<void> {
    if (!session.userId) throw new FulfillmentAccessError('Fulfillment access is restricted.');
    const result = await this.pool.query<{ role: string }>(
      `SELECT role FROM app.users WHERE id = $1`,
      [session.userId],
    );
    if (result.rows[0]?.role !== 'FULFILLMENT_ADMIN') {
      throw new FulfillmentAccessError('Fulfillment access is restricted.');
    }
  }
}

async function upsertProvider(
  client: SqlClient,
  external: {
    externalProviderId: string;
    displayName: string;
    available: boolean;
    capabilities: Record<string, unknown>;
  },
  observedAt: Date,
): Promise<ProviderRow> {
  const result = await client.query<ProviderRow>(
    `INSERT INTO app.print_providers (
       id, adapter_type, external_id, display_name, external_available, capabilities, last_synced_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (adapter_type, external_id) DO UPDATE
       SET display_name = EXCLUDED.display_name, external_available = EXCLUDED.external_available,
           capabilities = EXCLUDED.capabilities, last_synced_at = EXCLUDED.last_synced_at, updated_at = now()
     RETURNING id, external_id`,
    [
      providerIdForExternal(external.externalProviderId),
      adapterType,
      external.externalProviderId,
      external.displayName,
      external.available,
      JSON.stringify(external.capabilities),
      observedAt,
    ],
  );
  return requireRow(result.rows[0], 'Could not save print provider.');
}

function providerIdForExternal(externalId: string): string {
  return `printify-${externalId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`;
}

async function recordOperationalEvent(
  client: SqlClient,
  eventName:
    | 'catalog_sync_started'
    | 'catalog_sync_succeeded'
    | 'catalog_sync_failed'
    | 'shipping_quote_received'
    | 'provider_status_changed',
  dimensions: Record<string, unknown>,
  providerId?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO app.fulfillment_operational_events (event_name, provider_id, dimensions)
     VALUES ($1, $2, $3::jsonb)`,
    [eventName, providerId ?? null, JSON.stringify(dimensions)],
  );
}

function mapSyncSummary(row: SyncRunRow): CatalogSyncSummary {
  return {
    id: row.id,
    status: row.status === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
    providersObserved: numberFrom(row.summary.providersObserved),
    variantsObserved: numberFrom(row.summary.variantsObserved),
    attempts: row.attempt_count,
  };
}

function numberFrom(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function requireRow<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message);
  return value;
}
