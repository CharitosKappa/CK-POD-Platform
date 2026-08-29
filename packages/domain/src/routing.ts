import { randomUUID } from 'node:crypto';

import { withTransaction, type SqlPool } from '@let-it-be/db';
import type { PrivateObjectStorage } from '@let-it-be/storage';

import { CatalogSyncService } from './fulfillment';
import type { FulfillmentService, NormalizedShippingQuote } from './fulfillment-contracts';

export type RoutingExclusionCode =
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_SUSPENDED'
  | 'EXTERNAL_PROVIDER_UNAVAILABLE'
  | 'QUALIFICATION_NOT_APPROVED'
  | 'QUALIFICATION_INACTIVE'
  | 'TECHNICAL_INCOMPATIBILITY'
  | 'VARIANT_UNAVAILABLE'
  | 'DESTINATION_UNSUPPORTED'
  | 'SHIPPING_UNAVAILABLE'
  | 'PRODUCTION_PROFILE_UNAVAILABLE'
  | 'PREPRESS_NOT_READY'
  | 'MARGIN_BELOW_FLOOR'
  | 'LANDED_COST_ABOVE_CEILING';

export interface RoutingExclusion {
  code: RoutingExclusionCode;
  message: string;
}

export interface LandedCost {
  baseProductionCents: number;
  variantCents: number;
  decorationCents: number;
  providerFeeCents: number;
  shippingCents: number;
  currency: string;
  totalCents: number;
}

export interface RoutingCandidateResult {
  qualificationId: string;
  providerId: string;
  providerName: string;
  eligible: boolean;
  exclusions: RoutingExclusion[];
  landedCost: LandedCost | null;
  shippingQuote: NormalizedShippingQuote | null;
  ranking: {
    compatibility: number;
    availability: number;
    reliability: number;
    delivery: number;
    landedCost: number;
    total: number;
  } | null;
}

export interface RoutingDecision {
  id: string;
  status: 'ROUTED' | 'NO_ELIGIBLE_CANDIDATE';
  selectedQualificationId: string | null;
  candidates: RoutingCandidateResult[];
  configuration: { id: string; version: number };
}

export interface RoutingRequest {
  productModelId: string;
  productVariantId: string;
  destinationCountry: string;
  retailPriceCents: number;
  projectId?: string;
  prepressRunId?: string;
  configurationId?: string;
}

interface ConfigurationRow {
  id: string;
  version: number;
  configuration: RoutingConfiguration;
}

interface RoutingConfiguration {
  minimumContributionCents: number;
  maximumLandedCostCents: number;
  weights: {
    compatibility: number;
    availability: number;
    reliability: number;
    delivery: number;
    landedCost: number;
  };
  printifyOrderRoutingFallbackEnabled: boolean;
}

interface CandidateRow {
  qualification_id: string;
  product_model_id: string;
  provider_id: string;
  provider_name: string;
  provider_status: 'ENABLED' | 'SUSPENDED' | 'DISABLED';
  external_available: boolean;
  qualification_status: 'UNQUALIFIED' | 'UNDER_REVIEW' | 'QUALIFIED' | 'SUSPENDED' | 'REJECTED';
  active: boolean;
  technical_compatible: boolean;
  g3_reviewed: boolean;
  physical_test_status: 'NOT_TESTED' | 'PENDING' | 'PASSED' | 'FAILED';
  reliability_score: number;
  destination_countries: string[];
  shipping_enabled: boolean;
  production_profile_id: string | null;
  variant_available: boolean | null;
  base_production_cents: number | null;
  variant_cents: number | null;
  decoration_cents: number | null;
  provider_fee_cents: number | null;
  currency: string | null;
}

interface PrepressRow {
  status:
    'PENDING' | 'RENDERING' | 'VALIDATING' | 'PASSED' | 'REVIEW_REQUIRED' | 'BLOCKED' | 'FAILED';
  production_master_asset_id: string | null;
}

export class FulfillmentRoutingService {
  private readonly sync: CatalogSyncService;

  public constructor(
    private readonly pool: SqlPool,
    fulfillment: FulfillmentService,
  ) {
    this.sync = new CatalogSyncService(pool, fulfillment);
  }

  async evaluate(input: RoutingRequest): Promise<RoutingDecision> {
    if (!Number.isInteger(input.retailPriceCents) || input.retailPriceCents < 0) {
      throw new Error('Retail price must be a non-negative whole number of cents.');
    }
    const configuration = await this.configuration(input.configurationId);
    const prepress = input.prepressRunId ? await this.prepress(input.prepressRunId) : null;
    const candidates = await this.candidates(input.productModelId, input.productVariantId);
    const evaluated: RoutingCandidateResult[] = [];

    for (const candidate of candidates) {
      const exclusions = eligibilityExclusions(candidate, input.destinationCountry, prepress);
      let quote: NormalizedShippingQuote | null = null;
      let landedCost: LandedCost | null = null;
      if (!exclusions.length) {
        try {
          quote = await this.sync.quoteAndPersist({
            providerId: candidate.provider_id,
            productVariantId: input.productVariantId,
            destinationCountry: input.destinationCountry,
            qualificationId: candidate.qualification_id,
          });
          landedCost = calculateLandedCost(candidate, quote);
          if (landedCost.totalCents > configuration.configuration.maximumLandedCostCents) {
            exclusions.push({
              code: 'LANDED_COST_ABOVE_CEILING',
              message: 'This option exceeds the configured production-cost ceiling.',
            });
          }
          if (
            input.retailPriceCents - landedCost.totalCents <
            configuration.configuration.minimumContributionCents
          ) {
            exclusions.push({
              code: 'MARGIN_BELOW_FLOOR',
              message: 'This option does not protect the configured contribution floor.',
            });
          }
        } catch {
          exclusions.push({
            code: 'SHIPPING_UNAVAILABLE',
            message: 'A shipping estimate is unavailable for this destination.',
          });
        }
      }
      const ranking =
        exclusions.length || !landedCost || !quote
          ? null
          : rankingFor(candidate, landedCost, quote, configuration.configuration);
      const result: RoutingCandidateResult = {
        qualificationId: candidate.qualification_id,
        providerId: candidate.provider_id,
        providerName: candidate.provider_name,
        eligible: exclusions.length === 0,
        exclusions,
        landedCost,
        shippingQuote: quote,
        ranking,
      };
      evaluated.push(result);
      await this.recordCandidateEvent(result, input.productModelId);
    }

    const eligible = evaluated
      .filter((candidate) => candidate.eligible && candidate.ranking)
      .sort(
        (left, right) =>
          right.ranking!.total - left.ranking!.total ||
          left.providerId.localeCompare(right.providerId),
      );
    const decision: Omit<RoutingDecision, 'id'> = {
      status: eligible.length ? 'ROUTED' : 'NO_ELIGIBLE_CANDIDATE',
      selectedQualificationId: eligible[0]?.qualificationId ?? null,
      candidates: evaluated,
      configuration: { id: configuration.id, version: configuration.version },
    };
    const persisted = await this.persist(input, decision);
    return { id: persisted, ...decision };
  }

  private async configuration(id?: string): Promise<ConfigurationRow> {
    const result = await this.pool.query<ConfigurationRow>(
      id
        ? `SELECT id, version, configuration FROM app.routing_configurations WHERE id = $1`
        : `SELECT id, version, configuration FROM app.routing_configurations WHERE active = true`,
      id ? [id] : [],
    );
    return requireRow(result.rows[0], 'No active routing configuration is available.');
  }

  private async prepress(id: string): Promise<PrepressRow | null> {
    const result = await this.pool.query<PrepressRow>(
      `SELECT status, production_master_asset_id FROM app.prepress_runs WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  private async candidates(
    productModelId: string,
    productVariantId: string,
  ): Promise<CandidateRow[]> {
    const result = await this.pool.query<CandidateRow>(
      `SELECT q.id AS qualification_id, q.product_model_id, q.provider_id, p.display_name AS provider_name,
              p.status AS provider_status, p.external_available, q.qualification_status, q.active,
              q.technical_compatible, q.g3_reviewed, q.physical_test_status, q.destination_countries,
              q.shipping_enabled, q.reliability_score, ppm.production_profile_id, pv.available AS variant_available,
              c.base_production_cents, c.variant_cents, c.decoration_cents, c.provider_fee_cents, c.currency
       FROM app.provider_qualifications q
       JOIN app.print_providers p ON p.id = q.provider_id
       LEFT JOIN app.provider_profile_mappings ppm ON ppm.qualification_id = q.id
       LEFT JOIN app.provider_variants pv ON pv.provider_id = q.provider_id AND pv.product_variant_id = $2
       LEFT JOIN app.provider_costs c ON c.qualification_id = q.id AND c.is_current
       WHERE q.product_model_id = $1 AND q.decoration_method = 'DTG'`,
      [productModelId, productVariantId],
    );
    return result.rows;
  }

  private async recordCandidateEvent(
    candidate: RoutingCandidateResult,
    productModelId: string,
  ): Promise<void> {
    const eventName = candidate.eligible
      ? 'provider_candidate_evaluated'
      : 'provider_candidate_excluded';
    await this.pool.query(
      `INSERT INTO app.fulfillment_operational_events (event_name, product_model_id, provider_id, dimensions)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        eventName,
        productModelId,
        candidate.providerId,
        JSON.stringify({
          qualificationId: candidate.qualificationId,
          exclusions: candidate.exclusions.map((exclusion) => exclusion.code),
        }),
      ],
    );
  }

  private async persist(
    input: RoutingRequest,
    decision: Omit<RoutingDecision, 'id'>,
  ): Promise<string> {
    const id = randomUUID();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO app.routing_evaluations (
           id, project_id, prepress_run_id, product_model_id, product_variant_id, destination_country,
           retail_price_cents, routing_configuration_id, routing_configuration_version,
           selected_qualification_id, status, request_snapshot, decision_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)`,
        [
          id,
          input.projectId ?? null,
          input.prepressRunId ?? null,
          input.productModelId,
          input.productVariantId,
          input.destinationCountry,
          input.retailPriceCents,
          decision.configuration.id,
          decision.configuration.version,
          decision.selectedQualificationId,
          decision.status,
          JSON.stringify(input),
          JSON.stringify(decision),
        ],
      );
      await client.query(
        `INSERT INTO app.fulfillment_operational_events (
           event_name, product_model_id, routing_evaluation_id, dimensions
         ) VALUES ($1, $2, $3, $4::jsonb)`,
        [
          decision.status === 'ROUTED' ? 'routing_completed' : 'routing_failed',
          input.productModelId,
          id,
          JSON.stringify({ selectedQualificationId: decision.selectedQualificationId }),
        ],
      );
    });
    return id;
  }
}

/**
 * Copies only a production master that already satisfies a provider profile.
 * Transformations are intentionally absent until an explicit, safe provider
 * conversion is implemented; mismatches are retained as review-required.
 */
export class ProviderDerivativeService {
  public constructor(
    private readonly pool: SqlPool,
    private readonly storage: PrivateObjectStorage,
  ) {}

  async create(input: { prepressRunId: string; qualificationId: string }): Promise<{
    id: string;
    status: 'READY' | 'REVIEW_REQUIRED';
    derivativeAssetId: string | null;
  }> {
    const row = await this.pool.query<{
      production_master_asset_id: string;
      storage_key: string;
      content_type: string;
      width: number | null;
      height: number | null;
      byte_size: number;
      derivative_requirements: DerivativeRequirements;
    }>(
      `SELECT r.production_master_asset_id, a.storage_key, a.content_type, a.width, a.height, a.byte_size,
              ppm.derivative_requirements
       FROM app.prepress_runs r
       JOIN app.assets a ON a.id = r.production_master_asset_id AND a.asset_type = 'PRODUCTION_MASTER'
       JOIN app.provider_profile_mappings ppm ON ppm.qualification_id = $2
       WHERE r.id = $1 AND r.status IN ('PASSED', 'REVIEW_REQUIRED')`,
      [input.prepressRunId, input.qualificationId],
    );
    const source = requireRow(
      row.rows[0],
      'A validated production master and provider profile are required.',
    );
    const requirements = source.derivative_requirements ?? {};
    const valid = satisfiesDerivativeRequirements(source, requirements);
    const derivative = await this.pool.query<{ id: string }>(
      `INSERT INTO app.provider_derivatives (
         prepress_run_id, qualification_id, production_master_asset_id, status, requirement_snapshot, failure_detail
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
      [
        input.prepressRunId,
        input.qualificationId,
        source.production_master_asset_id,
        valid ? 'PENDING' : 'REVIEW_REQUIRED',
        JSON.stringify(requirements),
        valid ? null : 'The production master does not meet the provider derivative requirements.',
      ],
    );
    const id = requireRow(derivative.rows[0], 'Could not create provider derivative record.').id;
    if (!valid) return { id, status: 'REVIEW_REQUIRED', derivativeAssetId: null };
    const object = await this.storage.get(source.storage_key);
    if (!object) throw new Error('Production master is unavailable.');
    const storageKey = `fulfillment/${id}/provider-derivative.png`;
    await this.storage.put({
      key: storageKey,
      body: object.body,
      contentType: source.content_type,
      metadata: { assetClass: 'provider-derivative', source: source.production_master_asset_id },
    });
    const saved = await withTransaction(this.pool, async (client) => {
      const asset = await client.query<{ id: string }>(
        `INSERT INTO app.assets (
           project_id, asset_type, storage_key, content_type, byte_size, width, height, source_asset_id
         ) SELECT project_id, 'PROVIDER_DERIVATIVE', $1, content_type, byte_size, width, height, id
           FROM app.assets WHERE id = $2 RETURNING id`,
        [storageKey, source.production_master_asset_id],
      );
      const derivativeAssetId = requireRow(
        asset.rows[0],
        'Could not store provider derivative.',
      ).id;
      await client.query(
        `INSERT INTO app.asset_lineage (derived_asset_id, source_asset_id, relationship)
         VALUES ($1, $2, 'PROVIDER_DERIVATIVE_SOURCE')`,
        [derivativeAssetId, source.production_master_asset_id],
      );
      await client.query(
        `UPDATE app.provider_derivatives SET status = 'READY', derivative_asset_id = $2, completed_at = now() WHERE id = $1`,
        [id, derivativeAssetId],
      );
      return derivativeAssetId;
    });
    return { id, status: 'READY', derivativeAssetId: saved };
  }
}

interface DerivativeRequirements {
  acceptedContentTypes?: string[];
  targetWidthPx?: number;
  targetHeightPx?: number;
  requiresTransparency?: boolean;
  maximumBytes?: number;
}

function eligibilityExclusions(
  candidate: CandidateRow,
  destinationCountry: string,
  prepress: PrepressRow | null,
): RoutingExclusion[] {
  const exclusions: RoutingExclusion[] = [];
  if (candidate.provider_status === 'DISABLED')
    exclusions.push({
      code: 'PROVIDER_DISABLED',
      message: 'This provider is disabled by operations.',
    });
  if (candidate.provider_status === 'SUSPENDED')
    exclusions.push({
      code: 'PROVIDER_SUSPENDED',
      message: 'This provider is currently suspended.',
    });
  if (!candidate.external_available)
    exclusions.push({
      code: 'EXTERNAL_PROVIDER_UNAVAILABLE',
      message: 'This provider is unavailable in the external catalog.',
    });
  if (
    candidate.qualification_status !== 'QUALIFIED' ||
    !candidate.g3_reviewed ||
    candidate.physical_test_status !== 'PASSED'
  )
    exclusions.push({
      code: 'QUALIFICATION_NOT_APPROVED',
      message: 'This product and provider combination is not approved for production.',
    });
  if (!candidate.active)
    exclusions.push({
      code: 'QUALIFICATION_INACTIVE',
      message: 'This provider candidate is inactive.',
    });
  if (!candidate.technical_compatible)
    exclusions.push({
      code: 'TECHNICAL_INCOMPATIBILITY',
      message: 'This candidate is not technically compatible.',
    });
  if (!candidate.variant_available)
    exclusions.push({
      code: 'VARIANT_UNAVAILABLE',
      message: 'The selected size or color is unavailable.',
    });
  if (!candidate.destination_countries.includes(destinationCountry))
    exclusions.push({
      code: 'DESTINATION_UNSUPPORTED',
      message: 'This provider does not serve the destination.',
    });
  if (!candidate.shipping_enabled)
    exclusions.push({
      code: 'SHIPPING_UNAVAILABLE',
      message: 'Shipping is not enabled for this candidate.',
    });
  if (!candidate.production_profile_id)
    exclusions.push({
      code: 'PRODUCTION_PROFILE_UNAVAILABLE',
      message: 'No provider-specific production profile is bound.',
    });
  if (!candidate.base_production_cents && candidate.base_production_cents !== 0)
    exclusions.push({
      code: 'LANDED_COST_ABOVE_CEILING',
      message: 'Current production cost data is unavailable.',
    });
  if (
    prepress &&
    (!['PASSED', 'REVIEW_REQUIRED'].includes(prepress.status) ||
      !prepress.production_master_asset_id)
  )
    exclusions.push({
      code: 'PREPRESS_NOT_READY',
      message: 'The production master is not ready for routing.',
    });
  return exclusions;
}

function calculateLandedCost(candidate: CandidateRow, quote: NormalizedShippingQuote): LandedCost {
  const baseProductionCents = candidate.base_production_cents ?? 0;
  const variantCents = candidate.variant_cents ?? 0;
  const decorationCents = candidate.decoration_cents ?? 0;
  const providerFeeCents = candidate.provider_fee_cents ?? 0;
  return {
    baseProductionCents,
    variantCents,
    decorationCents,
    providerFeeCents,
    shippingCents: quote.shippingCents,
    currency: candidate.currency ?? quote.currency,
    totalCents:
      baseProductionCents + variantCents + decorationCents + providerFeeCents + quote.shippingCents,
  };
}

function rankingFor(
  candidate: CandidateRow,
  landedCost: LandedCost,
  quote: NormalizedShippingQuote,
  configuration: RoutingConfiguration,
): RoutingCandidateResult['ranking'] {
  const compatibility = configuration.weights.compatibility;
  const availability = configuration.weights.availability;
  const reliability = candidate.reliability_score * configuration.weights.reliability;
  const delivery = -(quote.estimatedDeliveryMaxDays ?? 999) * configuration.weights.delivery;
  const cost = -landedCost.totalCents * configuration.weights.landedCost;
  return {
    compatibility,
    availability,
    reliability,
    delivery,
    landedCost: cost,
    total: compatibility + availability + reliability + delivery + cost,
  };
}

function satisfiesDerivativeRequirements(
  source: { content_type: string; width: number | null; height: number | null; byte_size: number },
  requirements: DerivativeRequirements,
): boolean {
  if (
    requirements.acceptedContentTypes &&
    !requirements.acceptedContentTypes.includes(source.content_type)
  )
    return false;
  if (requirements.targetWidthPx && source.width !== requirements.targetWidthPx) return false;
  if (requirements.targetHeightPx && source.height !== requirements.targetHeightPx) return false;
  if (requirements.maximumBytes && source.byte_size > requirements.maximumBytes) return false;
  return true;
}

function requireRow<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message);
  return value;
}
