import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';
import type { PrivateObjectStorage } from '@let-it-be/storage';

import type { ActiveSession } from './identity';
import {
  normalizeFulfillmentError,
  type FulfillmentIntegrationError,
  type FulfillmentService,
} from './fulfillment-contracts';
import {
  ProviderDerivativeService,
  FulfillmentRoutingService,
  type RoutingDecision,
} from './routing';
import { PolicyService } from './policy';
import type { PolicyOutcome } from './policy';
import type { LifecycleOrchestrator } from './operations-analytics';

export const canonicalOrderStates = [
  'DRAFT',
  'PAYMENT_PENDING',
  'PAID',
  'PREPRESS_REVIEW',
  'COMPLIANCE_REVIEW',
  'ROUTING',
  'READY_FOR_PRODUCTION',
  'SUBMITTED_TO_PRINTIFY',
  'IN_PRODUCTION',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'DELIVERED',
  'ON_HOLD',
  'FAILED',
  'CANCELLED',
  'REPRINT_REQUIRED',
  'REFUND_REQUIRED',
] as const;
export type CanonicalOrderState = (typeof canonicalOrderStates)[number];
export type ReviewStage = 'PREPRESS' | 'COMPLIANCE';
export type ReviewOutcome = 'APPROVED' | 'HELD' | 'REJECTED';
export type OperationalRole = 'ADMIN' | 'CX_OPS' | 'PREPRESS_REVIEWER';

export const operationalReasonCodes = [
  'LOW_RESOLUTION',
  'INVALID_PLACEMENT',
  'TRANSPARENCY_ISSUE',
  'BACKGROUND_ISSUE',
  'FONT_RENDERING_ISSUE',
  'PRINTABILITY_CONCERN',
  'PRODUCTION_PROFILE_MISMATCH',
  'MODERATION_REVIEW',
  'IP_REVIEW',
  'COPYRIGHT_CHARACTER',
  'FAN_ART',
  'BRAND_LOGO',
  'TRADEMARK_RISK',
  'PUBLIC_PERSON_LIKENESS',
  'PROTECTED_LYRICS',
  'ADULT_CONTENT',
  'VIOLENCE_POLICY',
  'WEAPON_POLICY',
  'POLICY_UNCERTAIN',
  'OTHER_COMPLIANCE_REVIEW',
  'PROTECTED_TEXT_OR_LYRICS',
  'LOGO_OR_BRAND_CONCERN',
  'POLICY_UNKNOWN',
  'PROVIDER_UNAVAILABLE',
  'VARIANT_UNAVAILABLE',
  'SHIPPING_UNAVAILABLE',
  'MARGIN_VIOLATION',
  'ROUTING_FAILURE',
  'NO_ELIGIBLE_PROVIDER',
  'PRINTIFY_ERROR',
  'DERIVATIVE_RENDER_ERROR',
  'OPERATIONAL_HOLD',
  'CUSTOMER_CANCELLATION_REQUEST',
] as const;
export type OperationalReasonCode = (typeof operationalReasonCodes)[number];
export function isOperationalReasonCode(value: string): value is OperationalReasonCode {
  return (operationalReasonCodes as readonly string[]).includes(value);
}

export class OrderOperationsAccessError extends Error {}
export class OrderTransitionError extends Error {}

export interface OrderOperationsConfiguration {
  /** Real Printify side effects require this flag in addition to the trusted action. */
  realProductionSubmissionEnabled: boolean;
  fulfillmentAdapter: 'fake' | 'printify';
  /** A stale action can be retried with its original provider idempotency key. */
  fulfillmentActionLeaseMs?: number;
}

export interface ReviewQueueItem {
  orderNumber: string;
  status: CanonicalOrderState;
  customerEmail: string;
  productName: string;
  colorCode: string;
  quantity: number;
  createdAt: Date;
  latestReason: string | null;
  policyOutcome: PolicyOutcome | null;
  policyFindingCodes: string[];
  policyRulesetId: string | null;
}

/**
 * A fulfillment group is the operational unit that will become one Printify
 * order. Customer-facing order reads remain aggregated at this stage.
 */
export interface FulfillmentGroupOperationItem {
  id: string;
  groupKey: string;
  adapterType: 'PRINTIFY';
  providerId: string;
  providerName: string;
  status: string;
  externalOrderId: string | null;
  shippingSnapshot: Record<string, unknown>;
  shipments: Array<{
    trackingNumber: string | null;
    trackingUrl: string | null;
    carrier: string | null;
    service: string | null;
    status: string;
  }>;
  itemCount: number;
  createdAt: Date;
}

/**
 * The only post-payment workflow authority. It owns canonical transitions,
 * immutable operations audit records, review decisions, final routing, and the
 * explicit external fulfillment boundary. Payment continues to create PAID
 * platform orders without importing this service.
 */
export class OrderOperationsService {
  private readonly routing: FulfillmentRoutingService;
  private readonly derivatives: ProviderDerivativeService;
  private readonly fulfillmentActionLeaseMs: number;

  public constructor(
    private readonly pool: SqlPool,
    storage: PrivateObjectStorage,
    private readonly fulfillment: FulfillmentService,
    private readonly configuration: OrderOperationsConfiguration,
    private readonly policy: PolicyService = new PolicyService(pool),
    private readonly lifecycle?: LifecycleOrchestrator,
  ) {
    this.routing = new FulfillmentRoutingService(pool, fulfillment);
    this.derivatives = new ProviderDerivativeService(pool, storage);
    this.fulfillmentActionLeaseMs = configuration.fulfillmentActionLeaseMs ?? 5 * 60 * 1000;
  }

  async listReviewQueue(
    session: ActiveSession,
    filters: { state?: CanonicalOrderState; reason?: string } = {},
  ): Promise<ReviewQueueItem[]> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS', 'PREPRESS_REVIEWER']);
    const values: unknown[] = [];
    const where = [
      `o.status IN ('PAID', 'PREPRESS_REVIEW', 'COMPLIANCE_REVIEW', 'ROUTING', 'ON_HOLD', 'FAILED')`,
    ];
    if (filters.state) {
      values.push(filters.state);
      where.push(`o.status = $${values.length}`);
    }
    if (filters.reason) {
      values.push(filters.reason);
      where.push(
        `EXISTS (SELECT 1 FROM app.order_reviews r WHERE r.order_id = o.id AND r.reason_code = $${values.length})`,
      );
    }
    const result = await this.pool.query<{
      order_number: string;
      status: CanonicalOrderState;
      customer_email: string;
      product_name: string;
      color_code: string;
      quantity: number;
      created_at: Date;
      latest_reason: string | null;
      policy_outcome: PolicyOutcome | null;
      policy_finding_codes: string[];
      policy_ruleset_id: string | null;
    }>(
      `SELECT o.order_number, o.status, o.customer_email, m.display_name AS product_name,
              oi.item_snapshot->>'colorCode' AS color_code, oi.quantity, o.created_at,
              (SELECT r.reason_code FROM app.order_reviews r WHERE r.order_id = o.id ORDER BY r.created_at DESC LIMIT 1) AS latest_reason,
              pe.machine_result AS policy_outcome, pe.ruleset_id AS policy_ruleset_id,
              COALESCE((SELECT array_agg(f.code ORDER BY f.created_at) FROM app.policy_findings f WHERE f.evaluation_id = pe.id), ARRAY[]::text[]) AS policy_finding_codes
       FROM app.orders o JOIN app.order_items oi ON oi.order_id = o.id
       JOIN app.product_models m ON m.id = oi.product_model_id
       LEFT JOIN LATERAL (
         SELECT * FROM app.policy_evaluations x WHERE x.order_id = o.id
           AND x.stage = 'FINAL_ARTWORK_PRE_PRODUCTION' ORDER BY x.created_at DESC LIMIT 1
       ) pe ON true
       WHERE ${where.join(' AND ')} ORDER BY o.created_at ASC`,
      values,
    );
    return result.rows.map((row) => ({
      orderNumber: row.order_number,
      status: row.status,
      customerEmail: row.customer_email,
      productName: row.product_name,
      colorCode: row.color_code,
      quantity: row.quantity,
      createdAt: row.created_at,
      latestReason: row.latest_reason,
      policyOutcome: row.policy_outcome,
      policyFindingCodes: row.policy_finding_codes,
      policyRulesetId: row.policy_ruleset_id,
    }));
  }

  /**
   * Operations-only visibility into the units that will be submitted to
   * Printify independently. It intentionally does not alter the existing
   * customer order response.
   */
  async listFulfillmentGroups(
    session: ActiveSession,
    orderNumber: string,
  ): Promise<FulfillmentGroupOperationItem[]> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS']);
    const result = await this.pool.query<{
      id: string;
      group_key: string;
      adapter_type: 'PRINTIFY';
      provider_id: string;
      provider_name: string;
      status: string;
      external_order_id: string | null;
      shipping_snapshot: Record<string, unknown>;
      shipments: FulfillmentGroupOperationItem['shipments'];
      item_count: number;
      created_at: Date;
    }>(
      `SELECT fulfillment_group.id, fulfillment_group.group_key, fulfillment_group.adapter_type,
              fulfillment_group.provider_id, provider.display_name AS provider_name,
              fulfillment_group.status, fulfillment_group.external_order_id,
              fulfillment_group.shipping_snapshot,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'trackingNumber', shipment.tracking_number,
                    'trackingUrl', shipment.tracking_url,
                    'carrier', shipment.carrier,
                    'service', shipment.service,
                    'status', shipment.status
                  ) ORDER BY shipment.created_at
                ) FILTER (WHERE shipment.id IS NOT NULL),
                '[]'::jsonb
              ) AS shipments,
              COUNT(DISTINCT fulfillment_item.order_item_id)::int AS item_count,
              fulfillment_group.created_at
       FROM app.order_fulfillment_groups fulfillment_group
       JOIN app.orders orders ON orders.id = fulfillment_group.order_id
       JOIN app.print_providers provider ON provider.id = fulfillment_group.provider_id
       LEFT JOIN app.order_fulfillment_group_items fulfillment_item
         ON fulfillment_item.fulfillment_group_id = fulfillment_group.id
       LEFT JOIN app.order_shipments shipment
         ON shipment.fulfillment_group_id = fulfillment_group.id
       WHERE orders.order_number = $1
       GROUP BY fulfillment_group.id, provider.display_name
       ORDER BY fulfillment_group.created_at, fulfillment_group.group_key`,
      [orderNumber],
    );
    return result.rows.map((row) => ({
      id: row.id,
      groupKey: row.group_key,
      adapterType: row.adapter_type,
      providerId: row.provider_id,
      providerName: row.provider_name,
      status: row.status,
      externalOrderId: row.external_order_id,
      shippingSnapshot: row.shipping_snapshot,
      shipments: row.shipments,
      itemCount: row.item_count,
      createdAt: row.created_at,
    }));
  }

  /**
   * Revalidates the immutable provider qualification captured with a checkout
   * group. It never reroutes a paid group, because a provider switch would
   * invalidate the frozen shipping and cost snapshots.
   */
  async evaluateFulfillmentGroupReadiness(
    session: ActiveSession,
    input: { orderNumber: string; fulfillmentGroupId: string },
  ): Promise<{ ready: boolean; blockers: string[] }> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS']);
    const result = await this.pool.query<GroupReadinessRow>(
      `SELECT fulfillment_group.id AS fulfillment_group_id, fulfillment_group.order_id,
              orders.status AS order_status, fulfillment_group.qualification_id,
              qualification.qualification_status, qualification.active AS qualification_active,
              qualification.g3_reviewed, qualification.physical_test_status,
              qualification.technical_compatible, qualification.shipping_enabled,
              qualification.destination_countries,
              provider.status AS provider_status, provider.external_available,
              order_item.prepress_run_id, prepress.status AS prepress_status,
              prepress.production_master_asset_id,
              provider_variant.available AS provider_variant_available,
              profile_mapping.qualification_id AS qualification_profile_id,
              (SELECT count(*)::int FROM app.proof_approvals proof
               WHERE proof.cart_item_id = order_item.cart_item_id
                 AND proof.approval_state = 'APPROVED'
                 AND proof.project_version_id = order_item.project_version_id
                 AND proof.prepress_run_id = order_item.prepress_run_id
                 AND proof.mockup_id = order_item.mockup_id) AS approved_proofs,
              (SELECT outcome FROM app.order_reviews review
               WHERE review.order_id = orders.id AND review.stage = 'PREPRESS'
               ORDER BY review.created_at DESC LIMIT 1) AS prepress_review,
              (SELECT outcome FROM app.order_reviews review
               WHERE review.order_id = orders.id AND review.stage = 'COMPLIANCE'
               ORDER BY review.created_at DESC LIMIT 1) AS compliance_review,
              orders.shipping_address_snapshot->>'countryCode' AS destination_country
       FROM app.order_fulfillment_groups fulfillment_group
       JOIN app.orders orders ON orders.id = fulfillment_group.order_id
       JOIN app.provider_qualifications qualification ON qualification.id = fulfillment_group.qualification_id
       JOIN app.print_providers provider ON provider.id = fulfillment_group.provider_id
       JOIN app.order_fulfillment_group_items group_item
         ON group_item.fulfillment_group_id = fulfillment_group.id
       JOIN app.order_items order_item ON order_item.id = group_item.order_item_id
       JOIN app.prepress_runs prepress ON prepress.id = order_item.prepress_run_id
       LEFT JOIN app.provider_variants provider_variant
         ON provider_variant.provider_id = provider.id
        AND provider_variant.product_variant_id = order_item.product_variant_id
       LEFT JOIN app.provider_profile_mappings profile_mapping
         ON profile_mapping.qualification_id = qualification.id
        AND profile_mapping.production_profile_id = prepress.production_profile_id
       WHERE fulfillment_group.id = $1 AND orders.order_number = $2
       ORDER BY order_item.created_at`,
      [input.fulfillmentGroupId, input.orderNumber],
    );
    const rows = result.rows;
    const first = required(rows[0], 'Fulfillment group not found for this order.');
    const blockers = groupReadinessBlockers(rows);
    const policy = await this.policy.finalArtworkEligibility(input.orderNumber);
    if (!policy.eligible) blockers.push(policy.code);
    if (!blockers.length) {
      const group = await this.groupSubmissionContext(input.orderNumber, input.fulfillmentGroupId);
      for (const item of group.items.filter((candidate) => !candidate.derivativeAssetId)) {
        try {
          const derivative = await this.derivatives.create({
            prepressRunId: item.prepressRunId,
            qualificationId: group.qualificationId,
          });
          if (derivative.status !== 'READY' || !derivative.derivativeAssetId) {
            blockers.push('PROVIDER_DERIVATIVE');
          }
        } catch {
          blockers.push('PROVIDER_DERIVATIVE');
        }
      }
      const refreshed = await this.groupSubmissionContext(
        input.orderNumber,
        input.fulfillmentGroupId,
      );
      if (refreshed.items.some((item) => !item.derivativeAssetId)) {
        blockers.push('PROVIDER_DERIVATIVE');
      }
    }
    const uniqueBlockers = [...new Set(blockers)];
    const ready = uniqueBlockers.length === 0;
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO app.order_fulfillment_group_readiness_evaluations (
           fulfillment_group_id, ready, blockers, snapshot, created_by_user_id
         ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
        [
          first.fulfillment_group_id,
          ready,
          JSON.stringify(uniqueBlockers),
          JSON.stringify({
            qualificationId: first.qualification_id,
            providerStatus: first.provider_status,
            qualificationStatus: first.qualification_status,
            qualificationActive: first.qualification_active,
            g3Reviewed: first.g3_reviewed,
            physicalTestStatus: first.physical_test_status,
            technicallyCompatible: first.technical_compatible,
            providerExternallyAvailable: first.external_available,
            itemCount: rows.length,
            destinationCountry: first.destination_country,
          }),
          session.userId,
        ],
      );
      await client.query(
        `UPDATE app.order_fulfillment_groups
         SET status = $2, updated_at = now()
         WHERE id = $1 AND status IN ('PENDING', 'FAILED', 'READY_FOR_PRODUCTION')`,
        [first.fulfillment_group_id, ready ? 'READY_FOR_PRODUCTION' : 'PENDING'],
      );
      const order = await lockOrder(client, input.orderNumber);
      if (ready && order.status === 'ROUTING') {
        const pendingGroups = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM app.order_fulfillment_groups
           WHERE order_id = $1 AND status NOT IN ('READY_FOR_PRODUCTION', 'SUBMITTED', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED')`,
          [order.id],
        );
        if ((pendingGroups.rows[0]?.count ?? 0) === 0) {
          await this.transitionLocked(
            client,
            order,
            'READY_FOR_PRODUCTION',
            session,
            'PRINTABILITY_CONCERN',
          );
        }
      }
      await this.audit(client, order.id, 'fulfillment_group_readiness_evaluated', session, null, {
        fulfillmentGroupId: first.fulfillment_group_id,
        ready,
        blockers: uniqueBlockers,
      });
    });
    return { ready, blockers: uniqueBlockers };
  }

  async startPrepressReview(session: ActiveSession, orderNumber: string): Promise<void> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS', 'PREPRESS_REVIEWER']);
    await this.transitionByNumber(orderNumber, 'PREPRESS_REVIEW', {
      actor: session,
      reason: 'Manual review started.',
      reasonCode: 'PRINTABILITY_CONCERN',
    });
  }

  async decideReview(
    session: ActiveSession,
    input: {
      orderNumber: string;
      stage: ReviewStage;
      outcome: ReviewOutcome;
      reasonCode: OperationalReasonCode;
      notes?: string;
    },
  ): Promise<void> {
    await this.requireRole(
      session,
      input.stage === 'PREPRESS' ? ['ADMIN', 'CX_OPS', 'PREPRESS_REVIEWER'] : ['ADMIN', 'CX_OPS'],
    );
    if (input.stage === 'COMPLIANCE') {
      const evaluation = await this.policy.evaluateFinalArtworkForOrder(input.orderNumber);
      if (evaluation.outcome === 'BLOCK' && input.outcome !== 'REJECTED')
        throw new OrderTransitionError('Final artwork policy blocked production eligibility.');
      if (!session.userId) throw new OrderOperationsAccessError('Operations access is restricted.');
      await this.policy.recordHumanDecision({
        evaluationId: evaluation.id,
        actorUserId: session.userId,
        decision: input.outcome,
        reasonCode: input.reasonCode,
        ...(input.notes ? { notes: input.notes } : {}),
      });
    }
    const target = reviewTarget(input.stage, input.outcome);
    await withTransaction(this.pool, async (client) => {
      const order = await lockOrder(client, input.orderNumber);
      const required = input.stage === 'PREPRESS' ? 'PREPRESS_REVIEW' : 'COMPLIANCE_REVIEW';
      if (order.status !== required)
        throw new OrderTransitionError('This order is not awaiting that review.');
      await client.query(
        `INSERT INTO app.order_reviews (order_id, stage, outcome, reason_code, notes, actor_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          order.id,
          input.stage,
          input.outcome,
          input.reasonCode,
          input.notes ?? null,
          session.userId,
        ],
      );
      if (target === 'ON_HOLD') {
        await this.holdLocked(client, order, session, input.reasonCode, input.notes);
        return;
      }
      if (target === 'FAILED') {
        await this.transitionLocked(client, order, target, session, input.reasonCode, input.notes);
        return;
      }
      await this.transitionLocked(client, order, target, session, input.reasonCode, input.notes);
    });
    if (input.stage === 'COMPLIANCE' && input.outcome === 'APPROVED')
      await this.route(session, input.orderNumber, true);
  }

  async hold(
    session: ActiveSession,
    orderNumber: string,
    reasonCode: OperationalReasonCode,
    notes?: string,
  ): Promise<void> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS', 'PREPRESS_REVIEWER']);
    await withTransaction(this.pool, async (client) => {
      await this.holdLocked(
        client,
        await lockOrder(client, orderNumber),
        session,
        reasonCode,
        notes,
      );
    });
  }

  async resume(session: ActiveSession, orderNumber: string, notes?: string): Promise<void> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS', 'PREPRESS_REVIEWER']);
    let next: CanonicalOrderState | undefined;
    await withTransaction(this.pool, async (client) => {
      const order = await lockOrder(client, orderNumber);
      if (order.status !== 'ON_HOLD')
        throw new OrderTransitionError('Only a held order can be resumed.');
      const hold = await client.query<{ previous_state: CanonicalOrderState }>(
        `SELECT previous_state FROM app.order_holds WHERE order_id = $1 AND resumed_at IS NULL FOR UPDATE`,
        [order.id],
      );
      const previous = required(
        hold.rows[0],
        'The operational hold is unavailable.',
      ).previous_state;
      next = resumeTarget(previous);
      await client.query(
        `UPDATE app.order_holds SET resumed_at = now(), resumed_by_user_id = $2,
         resume_metadata = $3::jsonb WHERE order_id = $1 AND resumed_at IS NULL`,
        [
          order.id,
          session.userId,
          JSON.stringify({ notes: notes ?? null, resumedFrom: previous, target: next }),
        ],
      );
      await this.transitionLocked(client, order, next, session, 'OPERATIONAL_HOLD', notes);
    });
    if (next === 'ROUTING') await this.route(session, orderNumber, true);
  }

  async route(session: ActiveSession, orderNumber: string, alreadyRouting = false): Promise<void> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS']);
    const context = await withTransaction(this.pool, async (client) => {
      const order = await lockOrder(client, orderNumber);
      if (!alreadyRouting) {
        if (order.status !== 'COMPLIANCE_REVIEW') {
          throw new OrderTransitionError(
            'This order is not awaiting compliance review or routing.',
          );
        }
        await this.transitionLocked(client, order, 'ROUTING', session, 'ROUTING_FAILURE');
      } else if (order.status !== 'ROUTING')
        throw new OrderTransitionError('This order is not awaiting routing.');
      return await routeContext(client, order.id);
    });
    const decision = await this.routing.evaluate({
      projectId: context.projectId,
      prepressRunId: context.prepressRunId,
      productModelId: context.productModelId,
      productVariantId: context.productVariantId,
      destinationCountry: context.destinationCountry,
      retailPriceCents: context.retailPriceCents,
    });
    await this.persistRoutingDecision(session, orderNumber, context, decision);
  }

  async overrideProvider(
    session: ActiveSession,
    input: {
      orderNumber: string;
      qualificationId: string;
      reasonCode: OperationalReasonCode;
      notes?: string;
    },
  ): Promise<void> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS']);
    await withTransaction(this.pool, async (client) => {
      const order = await lockOrder(client, input.orderNumber);
      if (order.status !== 'ROUTING')
        throw new OrderTransitionError(
          'Provider selection is only available while routing is pending.',
        );
      const latest = await client.query<{
        routing_evaluation_id: string;
        recommended_qualification_id: string | null;
        snapshot: RoutingDecision;
      }>(
        `SELECT routing_evaluation_id, recommended_qualification_id, snapshot FROM app.order_final_routing
         WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [order.id],
      );
      const routing = required(latest.rows[0], 'A fresh final routing decision is required.');
      const candidate = routing.snapshot.candidates.find(
        (value) => value.qualificationId === input.qualificationId,
      );
      if (!candidate?.eligible)
        throw new OrderTransitionError('A provider override cannot bypass production eligibility.');
      await client.query(
        `INSERT INTO app.order_provider_overrides (
           order_id, routing_evaluation_id, recommended_qualification_id, selected_qualification_id, reason_code, notes, actor_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          order.id,
          routing.routing_evaluation_id,
          routing.recommended_qualification_id,
          input.qualificationId,
          input.reasonCode,
          input.notes ?? null,
          session.userId,
        ],
      );
      await client.query(
        `INSERT INTO app.order_final_routing (
           order_id, routing_evaluation_id, recommended_qualification_id, selected_qualification_id, status, snapshot, created_by_user_id
         ) VALUES ($1, $2, $3, $4, 'OVERRIDDEN', $5::jsonb, $6)`,
        [
          order.id,
          routing.routing_evaluation_id,
          routing.recommended_qualification_id,
          input.qualificationId,
          JSON.stringify(routing.snapshot),
          session.userId,
        ],
      );
      await this.audit(client, order.id, 'provider_override', session, input.reasonCode, {
        qualificationId: input.qualificationId,
      });
    });
    const context = await this.pool.query<{ prepress_run_id: string }>(
      `SELECT oi.prepress_run_id FROM app.orders o JOIN app.order_items oi ON oi.order_id = o.id WHERE o.order_number = $1`,
      [input.orderNumber],
    );
    await this.derivatives.create({
      prepressRunId: required(context.rows[0], 'Order routing data is unavailable.')
        .prepress_run_id,
      qualificationId: input.qualificationId,
    });
    await this.evaluateReadiness(session, input.orderNumber);
  }

  async evaluateReadiness(
    session: ActiveSession,
    orderNumber: string,
  ): Promise<{ ready: boolean; blockers: string[] }> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS']);
    const snapshot = await this.readinessSnapshot(orderNumber, { allowRouting: true });
    await withTransaction(this.pool, async (client) => {
      const order = await lockOrder(client, orderNumber);
      await client.query(
        `INSERT INTO app.order_readiness_evaluations (order_id, ready, blockers, snapshot, created_by_user_id)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
        [
          order.id,
          snapshot.blockers.length === 0,
          JSON.stringify(snapshot.blockers),
          JSON.stringify(snapshot),
          session.userId,
        ],
      );
      await this.audit(
        client,
        order.id,
        'readiness_evaluated',
        session,
        null,
        JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>,
      );
      if (!snapshot.blockers.length && order.status === 'ROUTING') {
        await this.transitionLocked(
          client,
          order,
          'READY_FOR_PRODUCTION',
          session,
          'PRINTABILITY_CONCERN',
        );
      }
    });
    return { ready: snapshot.blockers.length === 0, blockers: snapshot.blockers };
  }

  async submitProduction(
    session: ActiveSession,
    orderNumber: string,
  ): Promise<{ externalOrderId: string; duplicate: boolean }> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS']);
    if (
      this.configuration.fulfillmentAdapter === 'printify' &&
      !this.configuration.realProductionSubmissionEnabled
    ) {
      throw new OrderTransitionError(
        'Real production submission is disabled by environment safety configuration.',
      );
    }
    await this.assertSingleFulfillmentGroup(orderNumber);
    const previous = await this.pool.query<{ external_order_id: string }>(
      `SELECT a.external_order_id FROM app.order_fulfillment_actions a
       JOIN app.orders o ON o.id = a.order_id
       WHERE o.order_number = $1 AND a.action = 'SUBMIT_TO_PRODUCTION' AND a.status = 'SUCCEEDED'`,
      [orderNumber],
    );
    if (previous.rows[0]?.external_order_id) {
      return { externalOrderId: previous.rows[0].external_order_id, duplicate: true };
    }
    const readiness = await this.readinessSnapshot(orderNumber);
    if (readiness.blockers.length)
      throw new OrderTransitionError('This order is not ready for production.');
    const external = await this.createExternalOrder(session, orderNumber, readiness);
    const action = await this.beginAction(orderNumber, 'SUBMIT_TO_PRODUCTION', session);
    if (action.status === 'SUCCEEDED')
      return { externalOrderId: external.externalOrderId, duplicate: true };
    try {
      await this.fulfillment.submitProduction({
        idempotencyKey: action.idempotencyKey,
        externalOrderId: external.externalOrderId,
      });
      await withTransaction(this.pool, async (client) => {
        await this.finishAction(client, action.id, 'SUCCEEDED', external.externalOrderId);
        const order = await lockOrder(client, orderNumber);
        await this.transitionLocked(
          client,
          order,
          'SUBMITTED_TO_PRINTIFY',
          session,
          'PRINTIFY_ERROR',
        );
        await client.query(
          `UPDATE app.external_fulfillment_orders SET submission_state = 'SUBMITTED', submitted_at = now(), updated_at = now() WHERE order_id = $1`,
          [order.id],
        );
        await this.audit(client, order.id, 'production_submitted', session, null, {
          externalOrderId: external.externalOrderId,
        });
      });
      return { externalOrderId: external.externalOrderId, duplicate: false };
    } catch (error) {
      await this.failAction(action.id, normalizeFulfillmentError(error));
      throw error;
    }
  }

  /**
   * Creates and submits one Printify order for exactly one compatible
   * fulfillment group. Other groups on the platform order remain unaffected.
   */
  async submitFulfillmentGroup(
    session: ActiveSession,
    input: { orderNumber: string; fulfillmentGroupId: string },
  ): Promise<{ externalOrderId: string; duplicate: boolean }> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS']);
    if (
      this.configuration.fulfillmentAdapter === 'printify' &&
      !this.configuration.realProductionSubmissionEnabled
    ) {
      throw new OrderTransitionError(
        'Real production submission is disabled by environment safety configuration.',
      );
    }
    const readiness = await this.evaluateFulfillmentGroupReadiness(session, input);
    if (!readiness.ready) {
      throw new OrderTransitionError('This order is not ready for production.');
    }
    const group = await this.groupSubmissionContext(input.orderNumber, input.fulfillmentGroupId);
    const external = await this.createExternalOrderForGroup(session, group);
    const action = await this.beginGroupAction(
      input.orderNumber,
      input.fulfillmentGroupId,
      'SUBMIT_TO_PRODUCTION',
      session,
    );
    if (action.status === 'SUCCEEDED') {
      return { externalOrderId: external.externalOrderId, duplicate: true };
    }
    try {
      await this.fulfillment.submitProduction({
        idempotencyKey: action.idempotencyKey,
        externalOrderId: external.externalOrderId,
      });
      await withTransaction(this.pool, async (client) => {
        await this.finishAction(client, action.id, 'SUCCEEDED', external.externalOrderId);
        const order = await lockOrder(client, input.orderNumber);
        await client.query(
          `UPDATE app.order_fulfillment_groups
           SET status = 'SUBMITTED', updated_at = now()
           WHERE id = $1 AND order_id = $2`,
          [input.fulfillmentGroupId, order.id],
        );
        if (order.status === 'READY_FOR_PRODUCTION') {
          await this.transitionLocked(
            client,
            order,
            'SUBMITTED_TO_PRINTIFY',
            session,
            'PRINTIFY_ERROR',
          );
        }
        await this.audit(client, order.id, 'fulfillment_group_submitted', session, null, {
          fulfillmentGroupId: input.fulfillmentGroupId,
          externalOrderId: external.externalOrderId,
        });
      });
      return { externalOrderId: external.externalOrderId, duplicate: false };
    } catch (error) {
      await this.failAction(action.id, normalizeFulfillmentError(error));
      await this.pool.query(
        `UPDATE app.order_fulfillment_groups
         SET status = 'FAILED', updated_at = now()
         WHERE id = $1 AND status IN ('PENDING', 'READY_FOR_PRODUCTION')`,
        [input.fulfillmentGroupId],
      );
      throw error;
    }
  }

  async reconcileStatus(input: {
    externalOrderId: string;
    rawStatus: string;
    source: 'WEBHOOK' | 'POLLING';
    externalEventId?: string | null;
    tracking?: {
      trackingNumber: string;
      trackingUrl?: string | null;
      carrier?: string | null;
      service?: string | null;
    } | null;
  }): Promise<void> {
    let orderNotification: 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'DELIVERED' | null = null;
    await withTransaction(this.pool, async (client) => {
      const grouped = await client.query<{
        order_id: string;
        fulfillment_group_id: string | null;
      }>(
        `SELECT fulfillment_group.order_id, fulfillment_group.id AS fulfillment_group_id
         FROM app.order_fulfillment_groups fulfillment_group
          WHERE fulfillment_group.external_order_id = $1 FOR UPDATE`,
        [input.externalOrderId],
      );
      const legacy = grouped.rows[0]
        ? null
        : await client.query<{ order_id: string; fulfillment_group_id: null }>(
            `SELECT order_id, NULL::uuid AS fulfillment_group_id
             FROM app.external_fulfillment_orders WHERE external_order_id = $1 FOR UPDATE`,
            [input.externalOrderId],
          );
      const reference = grouped.rows[0] ?? legacy?.rows[0];
      if (!reference) return;
      const order = await lockOrderById(client, reference.order_id);
      const target = normalizeExternalStatus(input.rawStatus);
      if (reference.fulfillment_group_id && target) {
        await client.query(
          `UPDATE app.order_fulfillment_groups SET status = $2, updated_at = now() WHERE id = $1`,
          [reference.fulfillment_group_id, fulfillmentGroupStatus(target)],
        );
      }
      if (reference.fulfillment_group_id && input.tracking?.trackingNumber) {
        await client.query(
          `INSERT INTO app.order_shipments (
             order_id, fulfillment_group_id, external_order_id, carrier, service,
             tracking_number, tracking_url, shipped_at, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), 'SHIPPED')
           ON CONFLICT (fulfillment_group_id, tracking_number) WHERE fulfillment_group_id IS NOT NULL AND tracking_number IS NOT NULL
           DO UPDATE SET carrier = EXCLUDED.carrier, service = EXCLUDED.service,
                         tracking_url = EXCLUDED.tracking_url, status = 'SHIPPED', updated_at = now()`,
          [
            order.id,
            reference.fulfillment_group_id,
            input.externalOrderId,
            input.tracking.carrier ?? null,
            input.tracking.service ?? null,
            input.tracking.trackingNumber,
            input.tracking.trackingUrl ?? null,
          ],
        );
      }
      const aggregateTarget = reference.fulfillment_group_id
        ? await aggregateOrderFulfillmentStatus(client, order.id)
        : target;
      if (
        aggregateTarget === 'PARTIALLY_SHIPPED' ||
        aggregateTarget === 'SHIPPED' ||
        aggregateTarget === 'DELIVERED'
      )
        orderNotification = aggregateTarget;
      let disposition: 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'UNKNOWN' = target
        ? 'CONFLICT'
        : 'UNKNOWN';
      if (aggregateTarget && canTransition(order.status, aggregateTarget)) {
        await this.transitionLocked(
          client,
          order,
          aggregateTarget,
          null,
          'PRINTIFY_ERROR',
          `Provider status: ${input.rawStatus}`,
          input.source,
        );
        disposition = 'APPLIED';
      } else if (aggregateTarget === order.status) disposition = 'DUPLICATE';
      await client.query(
        `INSERT INTO app.order_fulfillment_status_events (order_id, external_event_id, source, raw_status, normalized_status, disposition, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (order_id, external_event_id) DO NOTHING`,
        [
          order.id,
          input.externalEventId ?? null,
          input.source,
          input.rawStatus,
          aggregateTarget,
          disposition,
          JSON.stringify({
            currentStatus: order.status,
            fulfillmentGroupId: reference.fulfillment_group_id,
          }),
        ],
      );
      await this.audit(
        client,
        order.id,
        'fulfillment_status_reconciled',
        null,
        null,
        {
          rawStatus: input.rawStatus,
          aggregateTarget,
          disposition,
          fulfillmentGroupId: reference.fulfillment_group_id,
        },
        input.source,
      );
    });
    if (this.lifecycle && orderNotification) {
      const groupedOrder = await this.pool.query<{
        id: string;
        customer_email: string;
        project_id: string;
      }>(
        `SELECT o.id, o.customer_email, i.project_id
         FROM app.order_fulfillment_groups fulfillment_group
         JOIN app.orders o ON o.id = fulfillment_group.order_id
         JOIN app.order_fulfillment_group_items fulfillment_item
           ON fulfillment_item.fulfillment_group_id = fulfillment_group.id
         JOIN app.order_items i ON i.id = fulfillment_item.order_item_id
         WHERE fulfillment_group.external_order_id = $1
         ORDER BY fulfillment_item.created_at
         LIMIT 1`,
        [input.externalOrderId],
      );
      const legacyOrder = groupedOrder.rows[0]
        ? null
        : await this.pool.query<{
            id: string;
            customer_email: string;
            project_id: string;
          }>(
            `SELECT o.id, o.customer_email, i.project_id
             FROM app.external_fulfillment_orders external_order
             JOIN app.orders o ON o.id = external_order.order_id
             JOIN app.order_items i ON i.order_id = o.id
             WHERE external_order.external_order_id = $1
             ORDER BY i.created_at
             LIMIT 1`,
            [input.externalOrderId],
          );
      const row = groupedOrder.rows[0] ?? legacyOrder?.rows[0];
      if (row) {
        const type =
          orderNotification === 'DELIVERED' ? 'DELIVERY_CONFIRMATION' : 'SHIPPING_CONFIRMATION';
        await this.lifecycle.trigger({
          type,
          classification: 'TRANSACTIONAL',
          recipientEmail: row.customer_email,
          orderId: row.id,
          projectId: row.project_id,
          idempotencyKey: `${type.toLowerCase()}:${row.id}`,
          payload: { orderStatus: orderNotification },
        });
        if (orderNotification === 'DELIVERED')
          await this.lifecycle.trigger({
            type: 'REVIEW_REQUEST',
            classification: 'MARKETING',
            recipientEmail: row.customer_email,
            orderId: row.id,
            projectId: row.project_id,
            idempotencyKey: `review-request:${row.id}`,
            payload: { orderStatus: orderNotification },
          });
      }
    }
  }

  /** A verified provider notification is evidence only; transition validation remains here. */
  async ingestFulfillmentWebhook(input: {
    body: string;
    signature: string | null;
  }): Promise<{ accepted: boolean }> {
    const verification = await this.fulfillment.verifyWebhook(input);
    if (!verification.valid) throw new OrderOperationsAccessError('Webhook verification failed.');
    const externalOrderId = stringField(verification.normalizedPayload.orderId);
    const status = stringField(verification.normalizedPayload.status);
    if (!externalOrderId || !status) return { accepted: true };
    await this.reconcileStatus({
      externalOrderId,
      rawStatus: status,
      source: 'WEBHOOK',
      externalEventId: verification.externalEventId,
    });
    return { accepted: true };
  }

  async pollStatus(session: ActiveSession, orderNumber: string): Promise<void> {
    await this.requireRole(session, ['ADMIN', 'CX_OPS']);
    const result = await this.pool.query<{ external_order_id: string }>(
      `SELECT external_order.external_order_id
       FROM app.external_fulfillment_orders external_order
       JOIN app.orders o ON o.id = external_order.order_id
       WHERE o.order_number = $1
       UNION ALL
       SELECT fulfillment_group.external_order_id
       FROM app.order_fulfillment_groups fulfillment_group
       JOIN app.orders o ON o.id = fulfillment_group.order_id
       WHERE o.order_number = $1 AND fulfillment_group.external_order_id IS NOT NULL`,
      [orderNumber],
    );
    if (result.rows.length === 0)
      throw new OrderOperationsAccessError('No external fulfillment order exists.');
    for (const { external_order_id: externalOrderId } of result.rows) {
      const status = await this.fulfillment.getOrderStatus({ externalOrderId });
      await this.reconcileStatus({ externalOrderId, rawStatus: status.state, source: 'POLLING' });
    }
  }

  private async persistRoutingDecision(
    session: ActiveSession,
    orderNumber: string,
    context: RouteContext,
    decision: RoutingDecision,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const order = await lockOrder(client, orderNumber);
      if (order.status !== 'ROUTING') return;
      await client.query(
        `INSERT INTO app.order_final_routing (
           order_id, routing_evaluation_id, recommended_qualification_id, selected_qualification_id, status, snapshot, created_by_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          order.id,
          decision.id,
          decision.selectedQualificationId,
          decision.selectedQualificationId,
          decision.status,
          JSON.stringify(decision),
          session.userId,
        ],
      );
      await this.audit(
        client,
        order.id,
        decision.status === 'ROUTED' ? 'final_routing_succeeded' : 'final_routing_failed',
        session,
        decision.status === 'ROUTED' ? null : 'NO_ELIGIBLE_PROVIDER',
        { routingEvaluationId: decision.id },
      );
      if (decision.status === 'NO_ELIGIBLE_CANDIDATE') {
        await this.holdLocked(
          client,
          order,
          session,
          'NO_ELIGIBLE_PROVIDER',
          'No currently qualified provider can fulfill this order.',
        );
      }
    });
    if (decision.status !== 'ROUTED') return;
    const derivative = await this.derivatives.create({
      prepressRunId: context.prepressRunId,
      qualificationId: decision.selectedQualificationId!,
    });
    if (derivative.status !== 'READY') {
      await this.hold(
        session,
        orderNumber,
        'DERIVATIVE_RENDER_ERROR',
        'Provider derivative requires operational review.',
      );
      return;
    }
    await this.evaluateReadiness(session, orderNumber);
  }

  private async createExternalOrder(
    session: ActiveSession,
    orderNumber: string,
    readiness: ReadinessSnapshot,
  ): Promise<{ externalOrderId: string }> {
    const existing = await this.pool.query<{ external_order_id: string }>(
      `SELECT external_order_id FROM app.external_fulfillment_orders e JOIN app.orders o ON o.id = e.order_id WHERE o.order_number = $1`,
      [orderNumber],
    );
    if (existing.rows[0]) return { externalOrderId: existing.rows[0].external_order_id };
    const action = await this.beginAction(orderNumber, 'CREATE_EXTERNAL_ORDER', session);
    if (action.status === 'SUCCEEDED' && action.externalOrderId)
      return { externalOrderId: action.externalOrderId };
    try {
      const result = await this.fulfillment.createOrder({
        idempotencyKey: action.idempotencyKey,
        externalProductId: readiness.externalProductId,
        items: [
          {
            externalVariantId: readiness.externalVariantId,
            quantity: readiness.quantity,
            artworkReference: `asset:${readiness.derivativeAssetId}`,
          },
        ],
      });
      await withTransaction(this.pool, async (client) => {
        const order = await lockOrder(client, orderNumber);
        await this.finishAction(client, action.id, 'SUCCEEDED', result.externalOrderId);
        await client.query(
          `INSERT INTO app.external_fulfillment_orders (
             order_id, adapter_type, qualification_id, provider_derivative_id, external_order_id, provider_snapshot
           ) VALUES ($1, 'PRINTIFY', $2, $3, $4, $5::jsonb)
           ON CONFLICT (order_id) DO NOTHING`,
          [
            order.id,
            readiness.qualificationId,
            readiness.derivativeId,
            result.externalOrderId,
            JSON.stringify(readiness),
          ],
        );
        await this.audit(client, order.id, 'fulfillment_order_created', session, null, {
          externalOrderId: result.externalOrderId,
        });
      });
      return { externalOrderId: result.externalOrderId };
    } catch (error) {
      await this.failAction(action.id, normalizeFulfillmentError(error));
      throw error;
    }
  }

  private async createExternalOrderForGroup(
    session: ActiveSession,
    group: FulfillmentGroupSubmissionContext,
  ): Promise<{ externalOrderId: string }> {
    if (group.externalOrderId) return { externalOrderId: group.externalOrderId };
    const action = await this.beginGroupAction(
      group.orderNumber,
      group.id,
      'CREATE_EXTERNAL_ORDER',
      session,
    );
    if (action.status === 'SUCCEEDED' && action.externalOrderId) {
      return { externalOrderId: action.externalOrderId };
    }
    try {
      const result = await this.fulfillment.createOrder({
        idempotencyKey: action.idempotencyKey,
        externalProviderId: group.externalProviderId,
        items: group.items.map((item) => ({
          externalBlueprintId: item.externalBlueprintId,
          externalVariantId: item.externalVariantId,
          quantity: item.quantity,
          artworkReference: `asset:${item.derivativeAssetId}`,
        })),
      });
      await withTransaction(this.pool, async (client) => {
        await this.finishAction(client, action.id, 'SUCCEEDED', result.externalOrderId);
        await client.query(
          `UPDATE app.order_fulfillment_groups
           SET external_order_id = $2, status = 'READY_FOR_PRODUCTION', updated_at = now()
           WHERE id = $1 AND external_order_id IS NULL`,
          [group.id, result.externalOrderId],
        );
        await this.audit(client, group.orderId, 'fulfillment_group_order_created', session, null, {
          fulfillmentGroupId: group.id,
          externalOrderId: result.externalOrderId,
          itemCount: group.items.length,
        });
      });
      return { externalOrderId: result.externalOrderId };
    } catch (error) {
      await this.failAction(action.id, normalizeFulfillmentError(error));
      throw error;
    }
  }

  private async groupSubmissionContext(
    orderNumber: string,
    fulfillmentGroupId: string,
  ): Promise<FulfillmentGroupSubmissionContext> {
    const result = await this.pool.query<GroupSubmissionRow>(
      `SELECT fulfillment_group.id AS fulfillment_group_id, fulfillment_group.order_id,
              orders.order_number, fulfillment_group.status AS fulfillment_group_status,
              fulfillment_group.external_order_id, qualification.id AS qualification_id,
              provider.external_id AS external_provider_id,
              order_item.prepress_run_id,
              checkout_item.item_snapshot->>'externalBlueprintId' AS external_blueprint_id,
              checkout_item.item_snapshot->>'externalVariantId' AS external_variant_id,
              order_item.quantity,
              derivative.derivative_asset_id
       FROM app.order_fulfillment_groups fulfillment_group
       JOIN app.orders orders ON orders.id = fulfillment_group.order_id
       JOIN app.provider_qualifications qualification ON qualification.id = fulfillment_group.qualification_id
       JOIN app.print_providers provider ON provider.id = fulfillment_group.provider_id
       JOIN app.order_fulfillment_group_items group_item
         ON group_item.fulfillment_group_id = fulfillment_group.id
       JOIN app.order_items order_item ON order_item.id = group_item.order_item_id
       JOIN app.checkout_fulfillment_group_items checkout_item
         ON checkout_item.cart_item_id = order_item.cart_item_id
        AND checkout_item.fulfillment_group_id = fulfillment_group.checkout_fulfillment_group_id
       LEFT JOIN LATERAL (
         SELECT derivative_asset_id
         FROM app.provider_derivatives
         WHERE prepress_run_id = order_item.prepress_run_id
           AND qualification_id = fulfillment_group.qualification_id
           AND status = 'READY'
         ORDER BY completed_at DESC NULLS LAST, created_at DESC
         LIMIT 1
       ) derivative ON true
       WHERE fulfillment_group.id = $1 AND orders.order_number = $2
       ORDER BY order_item.created_at`,
      [fulfillmentGroupId, orderNumber],
    );
    const first = required(result.rows[0], 'Fulfillment group not found for this order.');
    const invalid = result.rows.some(
      (row) => !row.external_blueprint_id || !row.external_variant_id,
    );
    if (invalid) {
      throw new OrderTransitionError(
        'The fulfillment group is missing a provider product mapping.',
      );
    }
    return {
      id: first.fulfillment_group_id,
      orderId: first.order_id,
      orderNumber: first.order_number,
      status: first.fulfillment_group_status,
      externalOrderId: first.external_order_id,
      qualificationId: first.qualification_id,
      externalProviderId: first.external_provider_id,
      items: result.rows.map((row) => ({
        prepressRunId: row.prepress_run_id,
        externalBlueprintId: row.external_blueprint_id as string,
        externalVariantId: row.external_variant_id as string,
        quantity: row.quantity,
        derivativeAssetId: row.derivative_asset_id,
      })),
    };
  }

  private async beginGroupAction(
    orderNumber: string,
    fulfillmentGroupId: string,
    action: 'CREATE_EXTERNAL_ORDER' | 'SUBMIT_TO_PRODUCTION',
    session: ActiveSession,
  ) {
    return withTransaction(this.pool, async (client) => {
      const order = await lockOrder(client, orderNumber);
      if (!['READY_FOR_PRODUCTION', 'SUBMITTED_TO_PRINTIFY'].includes(order.status)) {
        throw new OrderTransitionError(
          'Group fulfillment actions require an order that is ready for production.',
        );
      }
      const group = await client.query<{ id: string; external_order_id: string | null }>(
        `SELECT id, external_order_id FROM app.order_fulfillment_groups
         WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [fulfillmentGroupId, order.id],
      );
      if (!group.rows[0])
        throw new OrderTransitionError('Fulfillment group not found for this order.');
      const idempotencyKey = `fulfillment-group:${fulfillmentGroupId}:${action}:v1`;
      const existing = await client.query<{
        id: string;
        status: string;
        external_order_id: string | null;
        idempotency_key: string;
        updated_at: Date;
      }>(
        `SELECT id, status, external_order_id, idempotency_key, updated_at
         FROM app.order_fulfillment_actions
         WHERE fulfillment_group_id = $1 AND action = $2 FOR UPDATE`,
        [fulfillmentGroupId, action],
      );
      const row = existing.rows[0];
      if (row?.status === 'PROCESSING') {
        if (Date.now() - row.updated_at.getTime() < this.fulfillmentActionLeaseMs) {
          throw new OrderTransitionError('This fulfillment group action is already in progress.');
        }
        await client.query(
          `UPDATE app.order_fulfillment_actions
           SET attempt_count = attempt_count + 1, updated_at = now() WHERE id = $1`,
          [row.id],
        );
        await this.audit(client, order.id, 'fulfillment_action_reclaimed', session, null, {
          action,
          fulfillmentGroupId,
          idempotencyKey: row.idempotency_key,
        });
        return {
          id: row.id,
          idempotencyKey: row.idempotency_key,
          status: 'RETRYING',
          externalOrderId: row.external_order_id,
        };
      }
      if (row?.status === 'SUCCEEDED') {
        return {
          id: row.id,
          idempotencyKey: row.idempotency_key,
          status: 'SUCCEEDED',
          externalOrderId: row.external_order_id,
        };
      }
      if (row) {
        await client.query(
          `UPDATE app.order_fulfillment_actions
           SET status = 'PROCESSING', attempt_count = attempt_count + 1, updated_at = now() WHERE id = $1`,
          [row.id],
        );
        return {
          id: row.id,
          idempotencyKey: row.idempotency_key,
          status: row.status,
          externalOrderId: row.external_order_id,
        };
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app.order_fulfillment_actions (
           order_id, fulfillment_group_id, action, idempotency_key, status, attempt_count, requested_by_user_id
         ) VALUES ($1, $2, $3, $4, 'PROCESSING', 1, $5) RETURNING id`,
        [order.id, fulfillmentGroupId, action, idempotencyKey, session.userId],
      );
      return {
        id: required(inserted.rows[0], 'Could not begin fulfillment group action.').id,
        idempotencyKey,
        status: 'PROCESSING',
        externalOrderId: group.rows[0].external_order_id,
      };
    });
  }

  /**
   * The pre-group submit path is deliberately kept for compatibility with
   * existing operations. It must never collapse multiple fulfillment groups
   * into a single Printify order while group-scoped submission is introduced.
   */
  private async assertSingleFulfillmentGroup(orderNumber: string): Promise<void> {
    const result = await this.pool.query<{ group_count: number }>(
      `SELECT COUNT(*)::int AS group_count
       FROM app.order_fulfillment_groups fulfillment_group
       JOIN app.orders orders ON orders.id = fulfillment_group.order_id
       WHERE orders.order_number = $1`,
      [orderNumber],
    );
    if ((result.rows[0]?.group_count ?? 0) > 1) {
      throw new OrderTransitionError(
        'This order has multiple fulfillment groups and requires group-scoped production submission.',
      );
    }
  }

  private async beginAction(
    orderNumber: string,
    action: 'CREATE_EXTERNAL_ORDER' | 'SUBMIT_TO_PRODUCTION',
    session: ActiveSession,
  ) {
    return withTransaction(this.pool, async (client) => {
      const order = await lockOrder(client, orderNumber);
      if (order.status !== 'READY_FOR_PRODUCTION') {
        throw new OrderTransitionError(
          'External fulfillment actions require an order that is ready for production.',
        );
      }
      const idempotencyKey = `order:${order.id}:${action}:v1`;
      const existing = await client.query<{
        id: string;
        status: string;
        external_order_id: string | null;
        idempotency_key: string;
        updated_at: Date;
      }>(
        `SELECT id, status, external_order_id, idempotency_key, updated_at
         FROM app.order_fulfillment_actions WHERE order_id = $1 AND action = $2 FOR UPDATE`,
        [order.id, action],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.status === 'PROCESSING') {
          if (Date.now() - row.updated_at.getTime() < this.fulfillmentActionLeaseMs) {
            throw new OrderTransitionError('This fulfillment action is already in progress.');
          }
          await client.query(
            `UPDATE app.order_fulfillment_actions
             SET attempt_count = attempt_count + 1, updated_at = now()
             WHERE id = $1`,
            [row.id],
          );
          await this.audit(client, order.id, 'fulfillment_action_reclaimed', session, null, {
            action,
            idempotencyKey: row.idempotency_key,
          });
          return {
            id: row.id,
            idempotencyKey: row.idempotency_key,
            status: 'RETRYING',
            externalOrderId: row.external_order_id,
          };
        }
        if (row.status === 'SUCCEEDED') {
          return {
            id: row.id,
            idempotencyKey: row.idempotency_key,
            status: row.status,
            externalOrderId: row.external_order_id,
          };
        }
        await client.query(
          `UPDATE app.order_fulfillment_actions
           SET status = 'PROCESSING', attempt_count = attempt_count + 1, updated_at = now()
           WHERE id = $1`,
          [row.id],
        );
        await this.audit(client, order.id, 'fulfillment_action_retried', session, null, {
          action,
          idempotencyKey: row.idempotency_key,
        });
        return {
          id: row.id,
          idempotencyKey: row.idempotency_key,
          status: row.status,
          externalOrderId: row.external_order_id,
        };
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app.order_fulfillment_actions (order_id, action, idempotency_key, status, attempt_count, requested_by_user_id)
         VALUES ($1, $2, $3, 'PROCESSING', 1, $4) RETURNING id`,
        [order.id, action, idempotencyKey, session.userId],
      );
      return {
        id: required(inserted.rows[0], 'Could not begin fulfillment action.').id,
        idempotencyKey,
        status: 'PROCESSING',
        externalOrderId: null,
      };
    });
  }

  private async finishAction(
    client: SqlClient,
    id: string,
    status: 'SUCCEEDED',
    externalOrderId: string,
  ) {
    await client.query(
      `UPDATE app.order_fulfillment_actions SET status = $2, external_order_id = $3, completed_at = now(), updated_at = now(), failure_code = NULL, failure_detail = NULL WHERE id = $1`,
      [id, status, externalOrderId],
    );
  }
  private async failAction(id: string, error: FulfillmentIntegrationError) {
    await this.pool.query(
      `UPDATE app.order_fulfillment_actions SET status = $2, failure_code = $3, failure_detail = $4, updated_at = now() WHERE id = $1`,
      [id, error.retryable ? 'RETRYING' : 'FAILED', error.code, error.message],
    );
  }

  private async readinessSnapshot(
    orderNumber: string,
    options: { allowRouting?: boolean; allowSubmitted?: boolean } = {},
  ): Promise<ReadinessSnapshot> {
    const result = await this.pool.query<ReadinessRow>(
      `SELECT o.id, o.status, oi.project_id AS "projectId", oi.project_version_id AS "projectVersionId",
              oi.prepress_run_id AS "prepressRunId", oi.product_model_id AS "productModelId",
              oi.product_variant_id AS "productVariantId", oi.quantity AS quantity,
              o.shipping_address_snapshot->>'countryCode' AS "destinationCountry",
              (o.pricing_snapshot->>'subtotalCents')::int AS "retailPriceCents",
              r.status AS prepress_status, r.production_master_asset_id,
              (SELECT count(*)::int FROM app.proof_approvals pa WHERE pa.cart_item_id = oi.cart_item_id AND pa.approval_state = 'APPROVED'
                AND pa.project_version_id = oi.project_version_id AND pa.prepress_run_id = oi.prepress_run_id AND pa.mockup_id = oi.mockup_id) AS approved_proofs,
              (SELECT outcome FROM app.order_reviews pr WHERE pr.order_id = o.id AND pr.stage = 'PREPRESS' ORDER BY pr.created_at DESC LIMIT 1) AS prepress_review,
              (SELECT outcome FROM app.order_reviews cr WHERE cr.order_id = o.id AND cr.stage = 'COMPLIANCE' ORDER BY cr.created_at DESC LIMIT 1) AS compliance_review,
              fr.selected_qualification_id, fr.routing_evaluation_id,
              pd.id AS derivative_id, pd.derivative_asset_id, pd.status AS derivative_status,
              pm.external_blueprint_id AS external_product_id, vm.external_variant_id,
              q.qualification_status, q.active AS qualification_active,
              q.g3_reviewed, q.physical_test_status, q.technical_compatible,
              ppm.qualification_id AS qualification_profile_id, p.status AS provider_status,
              pv.available AS provider_variant_available
       FROM app.orders o JOIN app.order_items oi ON oi.order_id = o.id
       JOIN app.prepress_runs r ON r.id = oi.prepress_run_id
       LEFT JOIN LATERAL (SELECT * FROM app.order_final_routing x WHERE x.order_id = o.id ORDER BY x.created_at DESC LIMIT 1) fr ON true
       LEFT JOIN LATERAL (SELECT * FROM app.provider_derivatives d WHERE d.prepress_run_id = oi.prepress_run_id AND d.qualification_id = fr.selected_qualification_id ORDER BY d.completed_at DESC NULLS LAST, d.created_at DESC LIMIT 1) pd ON true
       LEFT JOIN app.fulfillment_product_mappings pm ON pm.product_model_id = oi.product_model_id AND pm.adapter_type = 'PRINTIFY'
       LEFT JOIN app.fulfillment_variant_mappings vm ON vm.product_variant_id = oi.product_variant_id AND vm.adapter_type = 'PRINTIFY'
       LEFT JOIN app.provider_qualifications q ON q.id = fr.selected_qualification_id
       LEFT JOIN app.print_providers p ON p.id = q.provider_id
       LEFT JOIN app.provider_variants pv ON pv.provider_id = q.provider_id AND pv.product_variant_id = oi.product_variant_id
       LEFT JOIN app.provider_profile_mappings ppm ON ppm.qualification_id = q.id AND ppm.production_profile_id = r.production_profile_id
       WHERE o.order_number = $1`,
      [orderNumber],
    );
    const row = required(result.rows[0], 'Order not found.');
    const blockers: string[] = [];
    if (
      row.status !== 'READY_FOR_PRODUCTION' &&
      !(options.allowRouting && row.status === 'ROUTING') &&
      !(options.allowSubmitted && row.status === 'SUBMITTED_TO_PRINTIFY')
    )
      blockers.push('ORDER_STAGE');
    if (row.approved_proofs !== 1) blockers.push('PROOF_APPROVAL');
    if (
      !['PASSED', 'REVIEW_REQUIRED'].includes(row.prepress_status) ||
      !row.production_master_asset_id
    )
      blockers.push('PREPRESS');
    if (row.prepress_review !== 'APPROVED') blockers.push('PREPRESS_REVIEW');
    if (row.compliance_review !== 'APPROVED') blockers.push('COMPLIANCE_REVIEW');
    if (!row.selected_qualification_id || !row.routing_evaluation_id)
      blockers.push('FINAL_ROUTING');
    if (
      row.qualification_status !== 'QUALIFIED' ||
      !row.qualification_active ||
      !row.g3_reviewed ||
      row.physical_test_status !== 'PASSED' ||
      !row.technical_compatible ||
      !row.qualification_profile_id ||
      row.provider_status !== 'ENABLED' ||
      !row.provider_variant_available
    )
      blockers.push('PROVIDER_QUALIFICATION');
    if (row.derivative_status !== 'READY' || !row.derivative_asset_id || !row.derivative_id)
      blockers.push('PROVIDER_DERIVATIVE');
    if (!row.external_product_id || !row.external_variant_id) blockers.push('PROVIDER_MAPPING');
    const policy = await this.policy.finalArtworkEligibility(orderNumber);
    if (!policy.eligible) blockers.push(policy.code);
    return {
      ...row,
      blockers,
      qualificationId: row.selected_qualification_id ?? '',
      derivativeId: row.derivative_id ?? '',
      derivativeAssetId: row.derivative_asset_id ?? '',
      externalProductId: row.external_product_id ?? '',
      externalVariantId: row.external_variant_id ?? '',
    };
  }

  private async transitionByNumber(
    orderNumber: string,
    target: CanonicalOrderState,
    input: TransitionInput,
  ) {
    await withTransaction(this.pool, async (client) =>
      this.transitionLocked(
        client,
        await lockOrder(client, orderNumber),
        target,
        input.actor,
        input.reasonCode,
        input.reason,
      ),
    );
  }
  private async transitionLocked(
    client: SqlClient,
    order: LockedOrder,
    target: CanonicalOrderState,
    actor: ActiveSession | null,
    reasonCode: string | null,
    reason?: string,
    actorType: 'SYSTEM' | 'OPS' | 'WEBHOOK' | 'POLLING' = actor ? 'OPS' : 'SYSTEM',
  ) {
    if (!canTransition(order.status, target))
      throw new OrderTransitionError(`Cannot move ${order.status} to ${target}.`);
    await client.query(`UPDATE app.orders SET status = $2, updated_at = now() WHERE id = $1`, [
      order.id,
      target,
    ]);
    await client.query(
      `INSERT INTO app.order_state_history (order_id, from_state, to_state, reason, actor_type, actor_user_id, reason_code, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        order.id,
        order.status,
        target,
        reason ?? target,
        actorType === 'OPS' ? 'OPS' : 'SYSTEM',
        actor?.userId ?? null,
        reasonCode,
        JSON.stringify({}),
      ],
    );
    await this.audit(
      client,
      order.id,
      'state_transition',
      actor,
      reasonCode,
      { from: order.status, to: target, reason: reason ?? null },
      actorType,
    );
  }
  private async holdLocked(
    client: SqlClient,
    order: LockedOrder,
    session: ActiveSession,
    reasonCode: OperationalReasonCode,
    notes?: string,
  ) {
    if (order.status === 'ON_HOLD')
      throw new OrderTransitionError('This order is already on hold.');
    const activeAction = await client.query<{ action: string }>(
      `SELECT action FROM app.order_fulfillment_actions
       WHERE order_id = $1 AND status = 'PROCESSING' FOR KEY SHARE`,
      [order.id],
    );
    if (activeAction.rows[0]) {
      throw new OrderTransitionError(
        'An external fulfillment action is in progress; the order cannot be placed on hold.',
      );
    }
    await client.query(
      `INSERT INTO app.order_holds (order_id, previous_state, reason_code, notes, held_by_user_id) VALUES ($1, $2, $3, $4, $5)`,
      [order.id, order.status, reasonCode, notes ?? null, session.userId],
    );
    await this.transitionLocked(client, order, 'ON_HOLD', session, reasonCode, notes);
  }
  private async audit(
    client: SqlClient,
    orderId: string,
    action: string,
    actor: ActiveSession | null,
    reasonCode: string | null,
    metadata: Record<string, unknown>,
    source: 'SYSTEM' | 'OPS' | 'WEBHOOK' | 'POLLING' = actor ? 'OPS' : 'SYSTEM',
  ) {
    await client.query(
      `INSERT INTO app.order_operational_audits (order_id, action, actor_type, actor_user_id, reason_code, metadata) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [orderId, action, source, actor?.userId ?? null, reasonCode, JSON.stringify(metadata)],
    );
  }
  private async requireRole(session: ActiveSession, allowed: OperationalRole[]) {
    if (!session.userId) throw new OrderOperationsAccessError('Operations access is restricted.');
    const result = await this.pool.query<{ role: string }>(
      `SELECT role FROM app.users WHERE id = $1`,
      [session.userId],
    );
    const role = result.rows[0]?.role === 'FULFILLMENT_ADMIN' ? 'ADMIN' : result.rows[0]?.role;
    if (!role || !allowed.includes(role as OperationalRole))
      throw new OrderOperationsAccessError('Operations access is restricted.');
  }
}

interface LockedOrder {
  id: string;
  status: CanonicalOrderState;
}
interface TransitionInput {
  actor: ActiveSession;
  reason: string;
  reasonCode: OperationalReasonCode;
}
interface RouteContext {
  projectId: string;
  prepressRunId: string;
  productModelId: string;
  productVariantId: string;
  destinationCountry: string;
  retailPriceCents: number;
}
interface ReadinessRow extends RouteContext {
  id: string;
  status: CanonicalOrderState;
  projectVersionId: string;
  quantity: number;
  production_master_asset_id: string | null;
  approved_proofs: number;
  prepress_status: string;
  prepress_review: string | null;
  compliance_review: string | null;
  selected_qualification_id: string | null;
  routing_evaluation_id: string | null;
  derivative_id: string | null;
  derivative_asset_id: string | null;
  derivative_status: string | null;
  external_product_id: string | null;
  external_variant_id: string | null;
  qualification_status: string | null;
  qualification_active: boolean | null;
  g3_reviewed: boolean | null;
  physical_test_status: string | null;
  technical_compatible: boolean | null;
  qualification_profile_id: string | null;
  provider_status: string | null;
  provider_variant_available: boolean | null;
}
interface ReadinessSnapshot extends ReadinessRow {
  blockers: string[];
  qualificationId: string;
  derivativeId: string;
  derivativeAssetId: string;
  externalProductId: string;
  externalVariantId: string;
}
interface GroupSubmissionRow {
  fulfillment_group_id: string;
  order_id: string;
  order_number: string;
  fulfillment_group_status: string;
  external_order_id: string | null;
  qualification_id: string;
  external_provider_id: string;
  prepress_run_id: string;
  external_blueprint_id: string | null;
  external_variant_id: string | null;
  quantity: number;
  derivative_asset_id: string | null;
}
interface GroupReadinessRow {
  fulfillment_group_id: string;
  order_id: string;
  order_status: CanonicalOrderState;
  qualification_id: string;
  qualification_status: string;
  qualification_active: boolean;
  g3_reviewed: boolean;
  physical_test_status: string;
  technical_compatible: boolean;
  shipping_enabled: boolean;
  destination_countries: string[];
  provider_status: string;
  external_available: boolean;
  prepress_run_id: string;
  prepress_status: string;
  production_master_asset_id: string | null;
  provider_variant_available: boolean | null;
  qualification_profile_id: string | null;
  approved_proofs: number;
  prepress_review: string | null;
  compliance_review: string | null;
  destination_country: string;
}
interface FulfillmentGroupSubmissionContext {
  id: string;
  orderId: string;
  orderNumber: string;
  status: string;
  externalOrderId: string | null;
  qualificationId: string;
  externalProviderId: string;
  items: Array<{
    prepressRunId: string;
    externalBlueprintId: string;
    externalVariantId: string;
    quantity: number;
    derivativeAssetId: string | null;
  }>;
}

function groupReadinessBlockers(rows: GroupReadinessRow[]): string[] {
  const first = required(rows[0], 'Fulfillment group is empty.');
  const blockers: string[] = [];
  if (!['ROUTING', 'READY_FOR_PRODUCTION', 'SUBMITTED_TO_PRINTIFY'].includes(first.order_status)) {
    blockers.push('ORDER_STAGE');
  }
  if (first.prepress_review !== 'APPROVED') blockers.push('PREPRESS_REVIEW');
  if (first.compliance_review !== 'APPROVED') blockers.push('COMPLIANCE_REVIEW');
  if (
    first.qualification_status !== 'QUALIFIED' ||
    !first.qualification_active ||
    !first.g3_reviewed ||
    first.physical_test_status !== 'PASSED' ||
    !first.technical_compatible ||
    first.provider_status !== 'ENABLED'
  ) {
    blockers.push('PROVIDER_QUALIFICATION');
  }
  for (const row of rows) {
    if (row.approved_proofs !== 1) blockers.push('PROOF_APPROVAL');
    if (
      !['PASSED', 'REVIEW_REQUIRED'].includes(row.prepress_status) ||
      !row.production_master_asset_id
    ) {
      blockers.push('PREPRESS');
    }
    if (!row.provider_variant_available) blockers.push('PROVIDER_VARIANT');
    if (!row.qualification_profile_id) blockers.push('PROVIDER_PROFILE');
  }
  return blockers;
}

async function lockOrder(client: SqlClient, orderNumber: string): Promise<LockedOrder> {
  const result = await client.query<LockedOrder>(
    `SELECT id, status FROM app.orders WHERE order_number = $1 FOR UPDATE`,
    [orderNumber],
  );
  return required(result.rows[0], 'Order not found.');
}
async function lockOrderById(client: SqlClient, id: string): Promise<LockedOrder> {
  const result = await client.query<LockedOrder>(
    `SELECT id, status FROM app.orders WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return required(result.rows[0], 'Order not found.');
}
async function routeContext(client: SqlClient, orderId: string): Promise<RouteContext> {
  const result = await client.query<{
    project_id: string;
    prepress_run_id: string;
    product_model_id: string;
    product_variant_id: string;
    destination_country: string;
    retail_price_cents: number;
  }>(
    `SELECT oi.project_id, oi.prepress_run_id, oi.product_model_id, oi.product_variant_id, o.shipping_address_snapshot->>'countryCode' AS destination_country, (o.pricing_snapshot->>'subtotalCents')::int AS retail_price_cents FROM app.orders o JOIN app.order_items oi ON oi.order_id = o.id WHERE o.id = $1`,
    [orderId],
  );
  const row = required(result.rows[0], 'Order routing data is unavailable.');
  return {
    projectId: row.project_id,
    prepressRunId: row.prepress_run_id,
    productModelId: row.product_model_id,
    productVariantId: row.product_variant_id,
    destinationCountry: row.destination_country,
    retailPriceCents: row.retail_price_cents,
  };
}
function reviewTarget(stage: ReviewStage, outcome: ReviewOutcome): CanonicalOrderState {
  if (outcome === 'HELD') return 'ON_HOLD';
  if (outcome === 'REJECTED') return 'FAILED';
  return stage === 'PREPRESS' ? 'COMPLIANCE_REVIEW' : 'ROUTING';
}
function resumeTarget(previous: CanonicalOrderState): CanonicalOrderState {
  return previous === 'COMPLIANCE_REVIEW'
    ? 'COMPLIANCE_REVIEW'
    : previous === 'ROUTING' || previous === 'READY_FOR_PRODUCTION'
      ? 'ROUTING'
      : 'PREPRESS_REVIEW';
}
async function aggregateOrderFulfillmentStatus(
  client: SqlClient,
  orderId: string,
): Promise<CanonicalOrderState | null> {
  const result = await client.query<{
    total: number;
    submitted: number;
    in_production: number;
    shipped_or_delivered: number;
    delivered: number;
    failed: number;
    cancelled: number;
  }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'SUBMITTED')::int AS submitted,
            COUNT(*) FILTER (WHERE status = 'IN_PRODUCTION')::int AS in_production,
            COUNT(*) FILTER (WHERE status IN ('SHIPPED', 'DELIVERED'))::int AS shipped_or_delivered,
            COUNT(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
            COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
            COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
     FROM app.order_fulfillment_groups WHERE order_id = $1`,
    [orderId],
  );
  const summary = result.rows[0];
  if (!summary || summary.total === 0) return null;
  if (summary.delivered === summary.total) return 'DELIVERED';
  if (summary.shipped_or_delivered === summary.total) return 'SHIPPED';
  if (summary.shipped_or_delivered > 0) return 'PARTIALLY_SHIPPED';
  if (summary.in_production > 0) return 'IN_PRODUCTION';
  if (summary.submitted > 0) return 'SUBMITTED_TO_PRINTIFY';
  if (summary.failed === summary.total) return 'FAILED';
  if (summary.cancelled === summary.total) return 'CANCELLED';
  return null;
}
function normalizeExternalStatus(value: string): CanonicalOrderState | null {
  const status = value.toLowerCase();
  if (['submitted', 'sent_to_production', 'sending_to_production'].includes(status))
    return 'SUBMITTED_TO_PRINTIFY';
  if (['in_production', 'printing'].includes(status)) return 'IN_PRODUCTION';
  if (status === 'shipped') return 'SHIPPED';
  if (status === 'delivered') return 'DELIVERED';
  if (['cancelled', 'canceled'].includes(status)) return 'CANCELLED';
  if (status === 'failed') return 'FAILED';
  return null;
}
function fulfillmentGroupStatus(
  target: CanonicalOrderState,
): 'SUBMITTED' | 'IN_PRODUCTION' | 'SHIPPED' | 'DELIVERED' | 'FAILED' | 'CANCELLED' {
  if (target === 'SUBMITTED_TO_PRINTIFY') return 'SUBMITTED';
  if (target === 'IN_PRODUCTION') return 'IN_PRODUCTION';
  if (target === 'SHIPPED') return 'SHIPPED';
  if (target === 'DELIVERED') return 'DELIVERED';
  if (target === 'FAILED') return 'FAILED';
  return 'CANCELLED';
}
function canTransition(from: CanonicalOrderState, to: CanonicalOrderState): boolean {
  const valid: Partial<Record<CanonicalOrderState, CanonicalOrderState[]>> = {
    PAID: ['PREPRESS_REVIEW', 'ON_HOLD', 'CANCELLED'],
    PREPRESS_REVIEW: ['COMPLIANCE_REVIEW', 'ON_HOLD', 'FAILED'],
    COMPLIANCE_REVIEW: ['ROUTING', 'ON_HOLD', 'FAILED'],
    ROUTING: ['READY_FOR_PRODUCTION', 'ON_HOLD', 'FAILED'],
    READY_FOR_PRODUCTION: ['SUBMITTED_TO_PRINTIFY', 'ON_HOLD', 'CANCELLED'],
    SUBMITTED_TO_PRINTIFY: [
      'IN_PRODUCTION',
      'PARTIALLY_SHIPPED',
      'SHIPPED',
      'FAILED',
      'CANCELLED',
      'ON_HOLD',
    ],
    IN_PRODUCTION: [
      'PARTIALLY_SHIPPED',
      'SHIPPED',
      'DELIVERED',
      'FAILED',
      'REPRINT_REQUIRED',
      'REFUND_REQUIRED',
      'ON_HOLD',
    ],
    PARTIALLY_SHIPPED: ['SHIPPED', 'DELIVERED', 'REPRINT_REQUIRED', 'REFUND_REQUIRED'],
    SHIPPED: ['DELIVERED', 'REPRINT_REQUIRED', 'REFUND_REQUIRED'],
    ON_HOLD: ['PREPRESS_REVIEW', 'COMPLIANCE_REVIEW', 'ROUTING', 'CANCELLED', 'FAILED'],
    FAILED: ['ON_HOLD', 'REFUND_REQUIRED', 'REPRINT_REQUIRED'],
    CANCELLED: ['REFUND_REQUIRED'],
    REPRINT_REQUIRED: ['ON_HOLD', 'REFUND_REQUIRED'],
  };
  return valid[from]?.includes(to) ?? false;
}
export function consumerOrderStatus(status: CanonicalOrderState): string {
  if (['PAID', 'PREPRESS_REVIEW', 'COMPLIANCE_REVIEW', 'ON_HOLD'].includes(status))
    return 'Order review';
  if (['ROUTING', 'READY_FOR_PRODUCTION', 'SUBMITTED_TO_PRINTIFY'].includes(status))
    return 'Preparing for production';
  if (status === 'IN_PRODUCTION') return 'In production';
  if (status === 'PARTIALLY_SHIPPED') return 'Partially shipped';
  if (status === 'SHIPPED') return 'Shipped';
  if (status === 'DELIVERED') return 'Delivered';
  return 'Order update needed';
}
function required<T>(value: T | undefined, message: string): T {
  if (!value) throw new OrderTransitionError(message);
  return value;
}
function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
