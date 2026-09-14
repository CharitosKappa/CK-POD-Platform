import { randomUUID } from 'node:crypto';
import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import {
  AdminCommerceValidationError,
  adminOrderLayerSql,
  type AdminStaffSession,
} from './admin-commerce';
import {
  resolveOrderActionEligibility,
  type CancellationStatus,
  type RefundDestination,
  type OrderActionEligibility,
  returnStates,
  type ReturnState,
} from './order-admin-actions-contracts';
import {
  projectPaymentState,
  type FulfillmentState,
  type PaymentStateEvidence,
  type PrintingGroupState,
} from './order-detail-contracts';
import { OrderOperationsAccessError, type OrderOperationsService } from './order-operations';
import { normalizeFulfillmentError, type FulfillmentService } from './fulfillment-contracts';
import {
  editedOrderBalanceWithClient,
  EditedOrderBalanceAttributionError,
  recordEditedOrderBalanceWithClient,
  type OrderRefundService,
} from './order-refunds';
import { LifecycleOrchestrator } from './operations-analytics';
import {
  CommerceValidationError,
  type OrderRepricingService,
  type PricingSnapshot,
  type ShippingAddressInput,
  type RepricedOrderItem,
} from './commerce';

export class OrderAdminActionAccessError extends OrderOperationsAccessError {}
export class OrderAdminActionValidationError extends AdminCommerceValidationError {}
export class OrderAdminActionNotFoundError extends Error {}
export class OrderAdminActionConflictError extends Error {
  constructor(
    message: string,
    public readonly eligibility?: OrderActionEligibility,
  ) {
    super(message);
  }
}

export interface ArchiveOrderInput {
  orderNumber: string;
  reasonCode: string;
  note?: string;
  idempotencyKey: string;
}

export interface ArchiveResult {
  orderId: string;
  archived: boolean;
  archivedAt: Date | null;
  duplicate: boolean;
}

export interface EditOrderInput extends ArchiveOrderInput {
  items?: Array<{ orderItemId?: string; productVariantId: string; quantity: number }>;
  discountCents?: number;
  shippingCents?: number;
  shippingAddress?: ShippingAddressInput;
  customerEmail?: string;
  customerPhone?: string;
  tags?: string[];
}

export interface EditOrderResult {
  revisionId: string;
  priceDifferenceCents: number;
  amountDueCents: number;
  refundableAdjustmentCents: number;
  eligibility: OrderActionEligibility;
  duplicate: boolean;
}

interface EditableOrderRow extends LockedOrder {
  customer_email: string;
  shipping_address_snapshot: ShippingAddressInput;
  pricing_snapshot: PricingSnapshot;
  financial_snapshot: Record<string, unknown>;
  amount_due_cents: number;
  refundable_adjustment_cents: number;
}

interface EditableItemRow {
  id: string;
  cart_item_id: string;
  project_id: string;
  project_version_id: string;
  prepress_run_id: string;
  mockup_id: string;
  product_model_id: string;
  product_variant_id: string;
  quantity: number;
  item_snapshot: Record<string, unknown>;
}

export interface CreateReturnInput {
  orderNumber: string;
  items: Array<{ orderItemId: string; quantity: number }>;
  reasonCode: string;
  shippingRequired: boolean;
  note?: string;
  idempotencyKey: string;
}

export interface TransitionReturnInput {
  orderNumber: string;
  returnId: string;
  toState: ReturnState;
  carrier?: string;
  trackingNumber?: string;
  note?: string;
  idempotencyKey: string;
}

export interface OrderReturnSummary {
  id: string;
  state: ReturnState;
  items: Array<{ orderItemId: string; quantity: number }>;
  reasonCode: string;
  shippingRequired: boolean;
  carrier: string | null;
  trackingNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type StoredReturnSummary = Omit<OrderReturnSummary, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

const returnTransitions: Record<ReturnState, readonly ReturnState[]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['IN_TRANSIT', 'REJECTED'],
  IN_TRANSIT: ['RECEIVED'],
  RECEIVED: ['CLOSED'],
  CLOSED: [],
  REJECTED: [],
};

export interface CancelOrderInput {
  orderNumber: string;
  refundDestination: RefundDestination;
  refundAmountCents: number;
  reasonCode: string;
  staffNote?: string;
  notifyCustomer: boolean;
  idempotencyKey: string;
}

export interface CancelOrderResult {
  cancellationId: string;
  status: CancellationStatus;
  orderStatus: string;
  unresolvedFulfillmentGroupIds: string[];
  /** Unconfirmed started mutations: read-only reconciliation or manual resolution only. */
  ambiguousFulfillmentGroupIds: string[];
  duplicate: boolean;
  refund: {
    destination: RefundDestination;
    amountCents: number;
    status: 'LATER' | 'PENDING' | 'SUCCEEDED' | 'FAILED';
    refundId: string | null;
    retryable: boolean;
  };
}

export interface RetryCancellationInput {
  orderNumber: string;
  cancellationId: string;
  idempotencyKey: string;
}

export interface OrderAdminActionsDependencies {
  fulfillment: FulfillmentService;
  operations: OrderOperationsService;
  refunds: OrderRefundService;
  lifecycle?: LifecycleOrchestrator;
  repricing?: OrderRepricingService;
}

interface CancellationRow {
  id: string;
  order_id: string;
  status: CancellationStatus;
  refund_destination: RefundDestination;
  refund_amount_cents: number;
  reason_code: string;
  staff_note: string | null;
  notify_customer: boolean;
}

interface CancellationGroupRow {
  id: string;
  fulfillment_group_id: string;
  external_order_id: string | null;
  status: 'REQUESTED' | 'CANCELLED' | 'NOT_REQUIRED' | 'UNAVAILABLE' | 'FAILED';
  attempt_count: number;
  provider_error_code: string | null;
}

interface LockedOrder {
  id: string;
  status: string;
  archived_at: Date | null;
  archived_by_staff_member_id: string | null;
}

interface StoredArchiveResult {
  orderId: string;
  archived: boolean;
  archivedAt: string | null;
}

/** Staff action boundary. Archive changes organization metadata only. */
export class OrderAdminActionsService {
  constructor(
    private readonly pool: SqlPool,
    private readonly dependencies?: OrderAdminActionsDependencies,
  ) {}

  async archive(session: AdminStaffSession, input: ArchiveOrderInput): Promise<ArchiveResult> {
    return this.setArchive(session, input, true);
  }

  async unarchive(session: AdminStaffSession, input: ArchiveOrderInput): Promise<ArchiveResult> {
    return this.setArchive(session, input, false);
  }

  async editOrder(session: AdminStaffSession, input: EditOrderInput): Promise<EditOrderResult> {
    this.validate(session, input);
    validateEdit(input);
    let replannedGroupIds: string[] = [];
    const result = await withTransaction(this.pool, async (client) => {
      const locked = await this.lockOrder(client, input.orderNumber);
      const existing = await this.existingAction<EditOrderResult>(
        client,
        locked.id,
        'order_edited',
        input.idempotencyKey,
      );
      if (existing) return { ...existing, duplicate: true };
      const eligibility = await this.loadEligibility(client, session, locked);
      const before = await editSnapshot(client, locked.id);
      const order = before.order;
      const commercial =
        input.items !== undefined ||
        input.discountCents !== undefined ||
        input.shippingCents !== undefined ||
        input.shippingAddress !== undefined;
      if (
        (input.items !== undefined && !eligibility.editFields.items) ||
        ((input.discountCents !== undefined || input.shippingCents !== undefined) &&
          !eligibility.editFields.pricing) ||
        (input.shippingAddress !== undefined && !eligibility.editFields.shippingAddress)
      )
        throw new OrderAdminActionConflictError(
          'These order fields are locked by fulfillment or production progress.',
          eligibility,
        );
      if (commercial) {
        const blockers = await client.query(
          `SELECT 1 FROM app.order_cancellations WHERE order_id=$1 AND (status IN ('REQUESTED','PROCESSING','PARTIAL','SUCCEEDED') OR EXISTS (SELECT 1 FROM app.order_cancellation_groups attempt WHERE attempt.order_cancellation_id=app.order_cancellations.id AND attempt.status='REQUESTED' AND (attempt.attempt_count>0 OR attempt.provider_error_code='CANCELLATION_OUTCOME_UNKNOWN')))
          UNION ALL SELECT 1 FROM app.order_fulfillment_actions WHERE order_id=$1 AND (status='PROCESSING' OR (action='CREATE_EXTERNAL_ORDER' AND (attempt_count>0 OR status<>'PENDING')))
          UNION ALL SELECT 1 FROM app.external_fulfillment_orders WHERE order_id=$1
          UNION ALL SELECT 1 FROM app.order_fulfillment_groups WHERE order_id=$1 AND (external_order_id IS NOT NULL OR printing_status IN ('SUBMITTING','SUBMITTED','IN_PRODUCTION','PRINTED') OR fulfillment_status<>'UNFULFILLED') LIMIT 1`,
          [locked.id],
        );
        if (
          blockers.rows.length ||
          [
            'CANCELLED',
            'SHIPPED',
            'DELIVERED',
            'PARTIALLY_SHIPPED',
            'IN_PRODUCTION',
            'SUBMITTED_TO_PRINTIFY',
          ].includes(locked.status)
        )
          throw new OrderAdminActionConflictError(
            'Commercial edits require an unsubmitted, unfulfilled order without an unresolved cancellation.',
            eligibility,
          );
      }
      let pricing = order.pricing_snapshot;
      let financial = order.financial_snapshot;
      let address = {
        ...order.shipping_address_snapshot,
        email: order.customer_email,
        ...input.shippingAddress,
        ...(input.customerPhone !== undefined ? { phone: input.customerPhone } : {}),
      };
      if (address.phone === '') delete address.phone;
      const email = input.customerEmail?.trim().toLowerCase() ?? order.customer_email;
      let amountDueCents = order.amount_due_cents;
      let refundableAdjustmentCents = order.refundable_adjustment_cents;
      const revisionId = randomUUID();
      let pendingRefunds: NonNullable<
        Awaited<ReturnType<typeof editedOrderBalanceWithClient>>
      >['pendingRefunds'] = [];
      if (commercial) {
        if (order.pricing_snapshot.currency !== 'USD')
          throw new OrderAdminActionValidationError(
            'Order editing supports the persisted USD currency only.',
          );
        const repricing = this.dependencies?.repricing;
        if (!repricing || !this.dependencies)
          throw new OrderAdminActionValidationError('Order repricing is unavailable.');
        let result: Awaited<ReturnType<OrderRepricingService['reprice']>>;
        try {
          result = await repricing.reprice(
            {
              items:
                input.items ??
                before.items.map((item) => ({
                  orderItemId: item.id,
                  productVariantId: item.product_variant_id,
                  quantity: item.quantity,
                })),
              discountCents: input.discountCents ?? pricing.discountCents,
              shippingCents: input.shippingCents ?? pricing.customerShippingCents,
              shippingAddress: address,
            },
            client,
          );
        } catch (error) {
          if (error instanceof CommerceValidationError)
            throw new OrderAdminActionValidationError(error.message);
          throw error;
        }
        const changedItems = result.items.map((item) => resolveEditedItem(item, before.items));
        address = result.shippingAddress;
        pricing = result.pricing;
        financial = {
          ...financial,
          editBalanceRevisionId: revisionId,
          revenueCents: pricing.subtotalCents,
          discountCents: pricing.discountCents,
          customerShippingRevenueCents: pricing.customerShippingCents,
          taxCollectedCents: pricing.taxCents,
          taxSnapshot: result.tax,
        };
        let balance: Awaited<ReturnType<typeof editedOrderBalanceWithClient>>;
        try {
          balance = await editedOrderBalanceWithClient(client, locked.id, pricing.totalCents);
        } catch (error) {
          if (error instanceof EditedOrderBalanceAttributionError)
            throw new OrderAdminActionConflictError(error.message, eligibility);
          throw error;
        }
        if (!balance)
          throw new OrderAdminActionValidationError('The order payment is unavailable.');
        amountDueCents = balance.amountDueCents;
        refundableAdjustmentCents = balance.refundableAdjustmentCents;
        pendingRefunds = balance.pendingRefunds;
        if (input.items !== undefined || input.shippingAddress !== undefined) {
          const plan = await repricing.plan(
            changedItems.map((item) => ({ ...item.price, orderItemId: item.id })),
            address.countryCode,
            this.dependencies.fulfillment,
            client,
          );
          // Unsubmitted group identities/history remain intact. Replace only their current planning.
          await client.query(
            'DELETE FROM app.order_fulfillment_group_items WHERE fulfillment_group_id IN (SELECT id FROM app.order_fulfillment_groups WHERE order_id=$1)',
            [locked.id],
          );
          await client.query(
            'DELETE FROM app.order_items WHERE order_id=$1 AND NOT (id=ANY($2::uuid[]))',
            [locked.id, changedItems.map((item) => item.id)],
          );
          for (const item of changedItems)
            await client.query(
              `INSERT INTO app.order_items (id,order_id,cart_item_id,project_id,project_version_id,prepress_run_id,mockup_id,product_model_id,product_variant_id,quantity,item_snapshot)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT (id) DO UPDATE SET product_variant_id=EXCLUDED.product_variant_id,quantity=EXCLUDED.quantity,item_snapshot=EXCLUDED.item_snapshot`,
              [
                item.id,
                locked.id,
                item.source.cart_item_id,
                item.source.project_id,
                item.source.project_version_id,
                item.source.prepress_run_id,
                item.source.mockup_id,
                item.price.productModelId,
                item.price.productVariantId,
                item.price.quantity,
                JSON.stringify({
                  ...item.source.item_snapshot,
                  productName: item.price.productName,
                  productVariantId: item.price.productVariantId,
                  colorCode: item.price.colorCode,
                  colorName: item.price.colorName,
                  size: item.price.size,
                  unitPriceCents: item.price.unitPriceCents,
                }),
              ],
            );
          replannedGroupIds = await this.dependencies.operations.replaceUnsubmittedPlanningLocked(
            client,
            session,
            input.orderNumber,
            plan,
          );
          financial = {
            ...financial,
            estimatedProviderShippingCostCents: plan.reduce(
              (sum, group) => sum + group.quote.shippingCents,
              0,
            ),
          };
        } else
          for (const item of changedItems)
            await client.query(
              'UPDATE app.order_items SET item_snapshot=item_snapshot || $2::jsonb WHERE id=$1',
              [item.id, JSON.stringify({ unitPriceCents: item.price.unitPriceCents })],
            );
      }
      await client.query(
        `UPDATE app.orders SET customer_email=$2,shipping_address_snapshot=$3::jsonb,pricing_snapshot=$4::jsonb,financial_snapshot=$5::jsonb,amount_due_cents=$6,refundable_adjustment_cents=$7,updated_at=now() WHERE id=$1`,
        [
          locked.id,
          email,
          JSON.stringify(address),
          JSON.stringify(pricing),
          JSON.stringify(financial),
          amountDueCents,
          refundableAdjustmentCents,
        ],
      );
      if (commercial && amountDueCents > 0)
        await this.dependencies!.operations.holdForEditLocked(
          client,
          session,
          input.orderNumber,
          input.reasonCode,
        );
      if (input.note?.trim())
        await client.query(
          'INSERT INTO app.order_notes (order_id,body,created_by_staff_member_id) VALUES ($1,$2,$3)',
          [locked.id, input.note.trim(), session.staffMemberId],
        );
      if (input.tags !== undefined) {
        await client.query('DELETE FROM app.order_tag_assignments WHERE order_id=$1', [locked.id]);
        const tagMap = new Map<string, string>();
        for (const tag of input.tags)
          if (!tagMap.has(tag.trim().toLowerCase()))
            tagMap.set(tag.trim().toLowerCase(), tag.trim());
        const tags = [...tagMap.values()].sort();
        for (const tag of tags)
          await client.query(
            `WITH tag AS (INSERT INTO app.order_tags (value) VALUES ($2) ON CONFLICT (lower(value)) DO UPDATE SET value=app.order_tags.value RETURNING id) INSERT INTO app.order_tag_assignments (order_id,order_tag_id,created_by_staff_member_id) SELECT $1,id,$3 FROM tag`,
            [locked.id, tag, session.staffMemberId],
          );
      }
      const after = await editSnapshot(client, locked.id);
      const priceDifferenceCents = pricing.totalCents - order.pricing_snapshot.totalCents;
      const revision = (
        await client.query<{ id: string }>(
          `INSERT INTO app.order_revisions (id,order_id,before_snapshot,after_snapshot,price_difference_cents,reason_code,note,created_by_staff_member_id,idempotency_key) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9) RETURNING id`,
          [
            revisionId,
            locked.id,
            JSON.stringify(before),
            JSON.stringify(after),
            priceDifferenceCents,
            input.reasonCode,
            input.note ?? null,
            session.staffMemberId,
            input.idempotencyKey,
          ],
        )
      ).rows[0]!;
      if (commercial)
        await recordEditedOrderBalanceWithClient(
          client,
          locked.id,
          {
            revisionId: revision.id,
            priceDifferenceCents,
            amountDueCents,
            refundableAdjustmentCents,
            pendingRefunds,
          },
          session.staffMemberId,
        );
      const result = {
        revisionId: revision.id,
        priceDifferenceCents,
        amountDueCents,
        refundableAdjustmentCents,
        eligibility: await this.loadEligibility(client, session, after.order),
        duplicate: false,
      };
      await this.audit(client, session, locked.id, 'order_edited', input, {
        revisionId: revision.id,
        result,
      });
      return result;
    });
    // Planning is committed in a non-submittable state. Reuse the full operational
    // qualification/proof/policy/derivative checks after releasing the edit transaction.
    if (!result.duplicate && result.amountDueCents === 0)
      for (const fulfillmentGroupId of replannedGroupIds) {
        try {
          await this.dependencies!.operations.evaluateFulfillmentGroupReadiness(session, {
            orderNumber: input.orderNumber,
            fulfillmentGroupId,
          });
        } catch {
          await this.pool.query(
            `INSERT INTO app.order_operational_audits (order_id,action,actor_type,actor_staff_member_id,reason_code,metadata)
          SELECT id,'order_edit_readiness_pending','OPS',$2,'ORDER_EDIT_REVIEW_REQUIRED',$3::jsonb FROM app.orders WHERE order_number=$1`,
            [
              input.orderNumber,
              session.staffMemberId,
              JSON.stringify({ revisionId: result.revisionId, fulfillmentGroupId }),
            ],
          );
        }
      }
    return result;
  }

  async createReturn(
    session: AdminStaffSession,
    input: CreateReturnInput,
  ): Promise<OrderReturnSummary> {
    this.validate(session, input);
    if (
      typeof input.shippingRequired !== 'boolean' ||
      !Array.isArray(input.items) ||
      !input.items.length ||
      input.items.some(
        (item) =>
          !item ||
          !isUuid(item.orderItemId) ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity <= 0,
      ) ||
      new Set(input.items.map((item) => item.orderItemId.toLowerCase())).size !== input.items.length
    ) {
      throw new OrderAdminActionValidationError(
        'Select distinct order items with positive whole quantities and a shipping choice.',
      );
    }
    return withTransaction(this.pool, async (client) => {
      const order = await this.lockOrder(client, input.orderNumber);
      const existing = await this.existingAction<StoredReturnSummary>(
        client,
        order.id,
        'order_return_created',
        input.idempotencyKey,
      );
      if (existing) return restoreReturnSummary(existing);
      // Match the Order -> Fulfillment Groups lock order used by cancellation and provider updates.
      await client.query(
        'SELECT id FROM app.order_fulfillment_groups WHERE order_id=$1 ORDER BY id FOR UPDATE',
        [order.id],
      );
      const available = await client.query<{ id: string; remaining: number }>(
        `SELECT item.id, GREATEST(0, item.quantity - COALESCE((
          SELECT sum(return_item.quantity) FROM app.order_return_items return_item
          JOIN app.order_returns returned ON returned.id=return_item.order_return_id
          WHERE return_item.order_item_id=item.id AND returned.state<>'REJECTED'
        ),0))::int AS remaining
        FROM app.order_items item
        JOIN app.order_fulfillment_group_items assignment ON assignment.order_item_id=item.id
        JOIN app.order_fulfillment_groups group_row ON group_row.id=assignment.fulfillment_group_id
        WHERE item.order_id=$1 AND group_row.order_id=$1
          AND group_row.fulfillment_status IN ('FULFILLED','DELIVERED')`,
        [order.id],
      );
      const quantities = new Map(available.rows.map((row) => [row.id, row.remaining]));
      if (
        input.items.some(
          (item) => item.quantity > (quantities.get(item.orderItemId.toLowerCase()) ?? 0),
        )
      )
        throw new OrderAdminActionConflictError(
          'The selected quantity exceeds the remaining fulfilled quantity.',
        );
      const created = (
        await client.query<{ id: string }>(
          `INSERT INTO app.order_returns (order_id,state,reason_code,shipping_required,note,created_by_staff_member_id,idempotency_key)
        VALUES ($1,'REQUESTED',$2,$3,$4,$5,$6) RETURNING id`,
          [
            order.id,
            input.reasonCode,
            input.shippingRequired,
            input.note ?? null,
            session.staffMemberId,
            input.idempotencyKey,
          ],
        )
      ).rows[0]!;
      for (const item of input.items)
        await client.query(
          'INSERT INTO app.order_return_items (order_return_id,order_item_id,quantity) VALUES ($1,$2,$3)',
          [created.id, item.orderItemId, item.quantity],
        );
      await this.returnEvent(client, session, created.id, null, 'REQUESTED', input);
      const result = await this.returnSummary(client, created.id);
      await this.audit(client, session, order.id, 'order_return_created', input, {
        result,
        returnId: created.id,
        items: result.items,
        shippingRequired: input.shippingRequired,
      });
      return result;
    });
  }

  async transitionReturn(
    session: AdminStaffSession,
    input: TransitionReturnInput,
  ): Promise<OrderReturnSummary> {
    this.validate(session, { ...input, reasonCode: 'RETURN_STATE_CHANGED' });
    if (
      !isUuid(input.returnId) ||
      !returnStates.includes(input.toState) ||
      [input.carrier, input.trackingNumber].some(
        (value) => value !== undefined && (typeof value !== 'string' || value.length > 200),
      )
    ) {
      throw new OrderAdminActionValidationError(
        'Provide a valid return, target state, and tracking fields of at most 200 characters.',
      );
    }
    return withTransaction(this.pool, async (client) => {
      const order = await this.lockOrder(client, input.orderNumber);
      const existing = await this.existingAction<StoredReturnSummary>(
        client,
        order.id,
        'order_return_transitioned',
        input.idempotencyKey,
      );
      if (existing) {
        if (existing.id !== input.returnId.toLowerCase() || existing.state !== input.toState)
          throw new OrderAdminActionConflictError(
            'Idempotency key belongs to another return transition.',
          );
        return restoreReturnSummary(existing);
      }
      const returned = (
        await client.query<{ state: ReturnState; reason_code: string }>(
          'SELECT state,reason_code FROM app.order_returns WHERE id=$1 AND order_id=$2 FOR UPDATE',
          [input.returnId, order.id],
        )
      ).rows[0];
      if (!returned) throw new OrderAdminActionNotFoundError('Return not found for this order.');
      if (!returnTransitions[returned.state]?.includes(input.toState))
        throw new OrderAdminActionConflictError('This return state transition is not allowed.');
      await client.query(
        `UPDATE app.order_returns SET state=$2,carrier=COALESCE($3,carrier),tracking_number=COALESCE($4,tracking_number),updated_at=now() WHERE id=$1`,
        [
          input.returnId,
          input.toState,
          input.carrier?.trim() ?? null,
          input.trackingNumber?.trim() ?? null,
        ],
      );
      await this.returnEvent(client, session, input.returnId, returned.state, input.toState, input);
      const result = await this.returnSummary(client, input.returnId);
      await this.audit(
        client,
        session,
        order.id,
        'order_return_transitioned',
        { ...input, reasonCode: returned.reason_code },
        {
          result,
          returnId: result.id,
          fromState: returned.state,
          toState: input.toState,
          carrier: result.carrier,
          trackingNumber: result.trackingNumber,
        },
      );
      return result;
    });
  }

  private async returnEvent(
    client: SqlClient,
    session: AdminStaffSession,
    returnId: string,
    fromState: ReturnState | null,
    toState: ReturnState,
    input: { note?: string; idempotencyKey: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO app.order_return_events (order_return_id,from_state,to_state,actor_staff_member_id,note,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        returnId,
        fromState,
        toState,
        session.staffMemberId,
        input.note ?? null,
        input.idempotencyKey,
      ],
    );
  }

  private async returnSummary(client: SqlClient, returnId: string): Promise<OrderReturnSummary> {
    const row = (
      await client.query<Omit<OrderReturnSummary, 'items'>>(
        `SELECT id,state,reason_code AS "reasonCode",shipping_required AS "shippingRequired",carrier,
        tracking_number AS "trackingNumber",created_at AS "createdAt",updated_at AS "updatedAt" FROM app.order_returns WHERE id=$1`,
        [returnId],
      )
    ).rows[0]!;
    const items = (
      await client.query<OrderReturnSummary['items'][number]>(
        `SELECT order_item_id AS "orderItemId",quantity FROM app.order_return_items WHERE order_return_id=$1 ORDER BY order_item_id`,
        [returnId],
      )
    ).rows;
    return { ...row, items };
  }

  async cancel(session: AdminStaffSession, input: CancelOrderInput): Promise<CancelOrderResult> {
    this.validate(session, {
      ...input,
      ...(input.staffNote === undefined ? {} : { note: input.staffNote }),
    });
    if (
      !['ORIGINAL_PAYMENT', 'STORE_CREDIT', 'LATER'].includes(input.refundDestination) ||
      !Number.isSafeInteger(input.refundAmountCents) ||
      input.refundAmountCents < 0 ||
      (input.refundDestination === 'LATER'
        ? input.refundAmountCents !== 0
        : input.refundAmountCents === 0) ||
      typeof input.notifyCustomer !== 'boolean'
    ) {
      throw new OrderAdminActionValidationError(
        'Provide a valid refund destination, amount, and notification choice.',
      );
    }
    return this.runCancellation(session, input);
  }

  async retryCancellation(
    session: AdminStaffSession,
    input: RetryCancellationInput,
  ): Promise<CancelOrderResult> {
    this.validate(session, { ...input, reasonCode: 'CUSTOMER_CANCELLATION_REQUEST' });
    if (
      typeof input.cancellationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.cancellationId)
    ) {
      throw new OrderAdminActionValidationError('Provide a valid cancellation identifier.');
    }
    return this.runCancellation(session, input);
  }

  private async runCancellation(
    session: AdminStaffSession,
    input: CancelOrderInput | RetryCancellationInput,
  ): Promise<CancelOrderResult> {
    const dependencies = this.dependencies;
    if (!dependencies) throw new Error('Cancellation services are not configured.');
    const lifecycle = dependencies.lifecycle ?? new LifecycleOrchestrator(this.pool);
    const client = await this.pool.connect();
    let workerLock: string | undefined;
    let reservation: { cancellation: CancellationRow; execute: boolean; duplicate: boolean };
    try {
      reservation = await transactionOn(client, async () => {
        const order = await this.lockOrder(client, input.orderNumber);
        const retry = 'cancellationId' in input;
        const action = retry ? 'order_cancellation_retried' : 'order_cancellation_requested';
        const existing = await this.existingAction<{ cancellationId: string }>(
          client,
          order.id,
          action,
          input.idempotencyKey,
        );
        if (retry && existing && existing.cancellationId !== input.cancellationId)
          throw new OrderAdminActionConflictError(
            'Idempotency key belongs to another cancellation.',
          );
        const eligibility = await this.loadEligibility(client, session, order);
        const found = await client.query<CancellationRow>(
          `SELECT * FROM app.order_cancellations WHERE order_id=$1 ORDER BY created_at,id FOR UPDATE`,
          [order.id],
        );
        let cancellation = found.rows[0];
        if (retry && (!cancellation || cancellation.id !== input.cancellationId))
          throw new OrderAdminActionNotFoundError('Cancellation not found for this order.');
        if (!retry && cancellation && !existing)
          throw new OrderAdminActionConflictError(
            'This order already has a cancellation. Retry that cancellation.',
          );
        if (
          cancellation &&
          (cancellation.status === 'SUCCEEDED' ||
            (existing && cancellation.status !== 'PROCESSING'))
        )
          return { cancellation, execute: false, duplicate: true };

        // A session lock spans external calls without holding a business transaction open.
        // It is shared by every process and released on connection loss. A prior started
        // REQUESTED attempt must then be reconciled read-only, never mutated again blindly.
        const key = `order-cancellation:${order.id}`;
        const claim = await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
          [key],
        );
        if (!claim.rows[0]?.acquired) {
          if (!cancellation)
            throw new OrderAdminActionConflictError('Cancellation is already in progress.');
          return { cancellation, execute: false, duplicate: true };
        }
        workerLock = key;
        // A matching recorded recovery may reconcile old work even after new evidence
        // blocks cancellation. This does not authorize another provider mutation: each
        // unresolved group still revalidates, and started ambiguous attempts are GET-only.
        const recordedRecovery =
          cancellation &&
          (retry || existing) &&
          ['REQUESTED', 'PROCESSING', 'PARTIAL', 'FAILED'].includes(cancellation.status);
        if (!eligibility.actions.cancel && !recordedRecovery)
          throw new OrderAdminActionConflictError(
            'This order is not eligible for cancellation.',
            eligibility,
          );
        const active = await client.query(
          `SELECT id FROM app.order_fulfillment_actions
          WHERE order_id=$1 AND status='PROCESSING'`,
          [order.id],
        );
        if (active.rows.length)
          throw new OrderAdminActionConflictError(
            'An external fulfillment action is in progress.',
            eligibility,
          );
        if (!cancellation) {
          if (retry) throw new OrderAdminActionNotFoundError('Cancellation not found.');
          const legacy = (
            await client.query<{ external_order_id: string }>(
              'SELECT external_order_id FROM app.external_fulfillment_orders WHERE order_id=$1',
              [order.id],
            )
          ).rows[0];
          const groups = (
            await client.query<{ id: string; external_order_id: string | null }>(
              'SELECT id,external_order_id FROM app.order_fulfillment_groups WHERE order_id=$1 ORDER BY id',
              [order.id],
            )
          ).rows;
          const ambiguousCreations = (
            await client.query<{
              id: string;
              fulfillment_group_id: string | null;
              status: 'PENDING' | 'RETRYING' | 'FAILED';
            }>(
              `SELECT id,fulfillment_group_id,status FROM app.order_fulfillment_actions
              WHERE order_id=$1 AND action='CREATE_EXTERNAL_ORDER' AND attempt_count>0
              AND status IN ('PENDING','RETRYING','FAILED') ORDER BY updated_at DESC,id DESC`,
              [order.id],
            )
          ).rows;
          if (
            legacy &&
            !groups.some((group) => group.external_order_id === legacy.external_order_id) &&
            (groups.length !== 1 || groups[0]!.external_order_id !== null)
          )
            throw new OrderAdminActionConflictError(
              'The legacy provider order must be linked to its fulfillment group.',
            );
          cancellation = (
            await client.query<CancellationRow>(
              `INSERT INTO app.order_cancellations (order_id,status,refund_destination,refund_amount_cents,
             reason_code,staff_note,notify_customer,initiated_by_staff_member_id,idempotency_key)
             VALUES ($1,'PROCESSING',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
              [
                order.id,
                input.refundDestination,
                input.refundAmountCents,
                input.reasonCode,
                input.staffNote ?? null,
                input.notifyCustomer,
                session.staffMemberId,
                input.idempotencyKey,
              ],
            )
          ).rows[0]!;
          for (const group of groups) {
            const externalOrderId =
              group.external_order_id ??
              (groups.length === 1 ? (legacy?.external_order_id ?? null) : null);
            const ambiguousCreation =
              externalOrderId === null
                ? ambiguousCreations.find(
                    (action) =>
                      action.fulfillment_group_id === group.id ||
                      (action.fulfillment_group_id === null && groups.length === 1),
                  )
                : undefined;
            await client.query(
              `INSERT INTO app.order_cancellation_groups
              (order_cancellation_id,fulfillment_group_id,external_order_id,status,provider_error_code,response_metadata)
              VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
              [
                cancellation.id,
                group.id,
                externalOrderId,
                externalOrderId || ambiguousCreation ? 'REQUESTED' : 'NOT_REQUIRED',
                ambiguousCreation ? 'CANCELLATION_OUTCOME_UNKNOWN' : null,
                JSON.stringify(
                  ambiguousCreation
                    ? {
                        upstreamAction: 'CREATE_EXTERNAL_ORDER',
                        upstreamActionId: ambiguousCreation.id,
                        upstreamActionStatus: ambiguousCreation.status,
                        requiresManualResolution: true,
                      }
                    : {},
                ),
              ],
            );
          }
        } else {
          await client.query(
            `UPDATE app.order_cancellations SET status='PROCESSING',failure_reason=NULL,
            completed_at=NULL,updated_at=now() WHERE id=$1`,
            [cancellation.id],
          );
          cancellation.status = 'PROCESSING';
        }
        if (!existing)
          await this.audit(
            client,
            session,
            order.id,
            action,
            {
              orderNumber: input.orderNumber,
              idempotencyKey: input.idempotencyKey,
              reasonCode: cancellation.reason_code,
              ...(cancellation.staff_note === null ? {} : { note: cancellation.staff_note }),
            },
            {
              result: { cancellationId: cancellation.id },
              refundDestination: cancellation.refund_destination,
              refundAmountCents: cancellation.refund_amount_cents,
              notifyCustomer: cancellation.notify_customer,
            },
          );
        return { cancellation, execute: true, duplicate: false };
      });
      const cancellation = reservation.cancellation;
      if (reservation.execute) {
        await this.cancelProviderGroups(
          client,
          session,
          input.orderNumber,
          cancellation,
          dependencies.fulfillment,
        );
        await transactionOn(client, async () => {
          const outcome = await dependencies.operations.finalizeCancellationWithClient(
            client,
            session,
            {
              orderNumber: input.orderNumber,
              cancellationId: cancellation.id,
            },
          );
          await client.query(
            `UPDATE app.order_cancellations SET status=$2,updated_at=now(),completed_at=now(),
            failure_reason=$3 WHERE id=$1`,
            [
              cancellation.id,
              outcome.status,
              outcome.status === 'SUCCEEDED' ? null : 'PROVIDER_CANCELLATION_UNRESOLVED',
            ],
          );
          await client.query(
            `INSERT INTO app.order_operational_audits
            (order_id,action,actor_type,actor_staff_member_id,reason_code,metadata)
            VALUES ($1,'order_cancellation_finalized','OPS',$2,$3,$4::jsonb)`,
            [
              cancellation.order_id,
              session.staffMemberId,
              cancellation.reason_code,
              JSON.stringify({
                cancellationId: cancellation.id,
                note: cancellation.staff_note,
                source: 'ADMIN',
                result: outcome,
                refundDestination: cancellation.refund_destination,
                refundAmountCents: cancellation.refund_amount_cents,
              }),
            ],
          );
          if (outcome.status === 'SUCCEEDED' && cancellation.notify_customer) {
            const customer = (
              await client.query<{ customer_email: string }>(
                'SELECT customer_email FROM app.orders WHERE id=$1',
                [cancellation.order_id],
              )
            ).rows[0]!;
            await lifecycle.enqueueTransactionalWithClient(client, {
              type: 'ORDER_CANCELLATION',
              recipientEmail: customer.customer_email,
              orderId: cancellation.order_id,
              idempotencyKey: `cancellation-notification:${cancellation.id}`,
              payload: {
                cancellationId: cancellation.id,
                orderNumber: input.orderNumber,
                refundDestination: cancellation.refund_destination,
                refundAmountCents: cancellation.refund_amount_cents,
              },
            });
          }
          cancellation.status = outcome.status;
        });
      }
    } finally {
      try {
        if (workerLock) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [workerLock]);
      } finally {
        client.release();
      }
    }
    // Downstream services own their transactions and pool acquisitions. Release the
    // cancellation worker before entering those independently idempotent boundaries.
    const cancellation = reservation.cancellation;
    if (cancellation.status === 'SUCCEEDED') {
      await this.settleCancellationRefund(
        this.pool,
        session,
        input.orderNumber,
        cancellation,
        dependencies.refunds,
      );
      if (cancellation.notify_customer) {
        const delivery = (
          await this.pool.query<{ id: string }>(
            `SELECT id FROM app.lifecycle_deliveries WHERE idempotency_key=$1`,
            [`cancellation-notification:${cancellation.id}`],
          )
        ).rows[0];
        if (delivery) await lifecycle.dispatchDelivery(delivery.id);
      }
    }
    return this.cancellationResult(this.pool, cancellation.id, reservation.duplicate);
  }

  private async settleCancellationRefund(
    client: SqlClient,
    session: AdminStaffSession,
    orderNumber: string,
    cancellation: CancellationRow,
    refunds: OrderRefundService,
  ): Promise<void> {
    if (cancellation.refund_destination === 'LATER') return;
    const receiptKey = `cancellation-refund-result:${cancellation.id}`;
    if (
      (
        await client.query('SELECT id FROM app.order_operational_audits WHERE idempotency_key=$1', [
          receiptKey,
        ])
      ).rows.length
    )
      return;
    const idempotencyKey = `cancellation-refund:${cancellation.id}`;
    let failureReason: string | null = null;
    try {
      const method =
        cancellation.refund_destination === 'STORE_CREDIT'
          ? 'refundToStoreCredit'
          : 'refundOriginalPayment';
      await refunds[method](
        {
          type: 'STAFF',
          staffMemberId: session.staffMemberId,
          role: session.role as 'OWNER' | 'OPERATIONS',
          email: session.email,
        },
        {
          orderNumber,
          amountCents: cancellation.refund_amount_cents,
          reasonCode: 'CANCELLED',
          idempotencyKey,
          ...(cancellation.staff_note === null ? {} : { note: cancellation.staff_note }),
        },
      );
    } catch (error) {
      failureReason = error instanceof Error ? error.message : 'Refund operation failed.';
    }
    const refund = (
      await client.query<{ id: string; status: string }>(
        'SELECT id,status FROM app.order_refunds WHERE idempotency_key=$1',
        [idempotencyKey],
      )
    ).rows[0];
    const refundStatus = refund?.status ?? 'FAILED';
    // A PENDING monetary reservation is retained for payment reconciliation, never reissued here.
    if (refundStatus === 'PENDING') return;
    await client.query(
      `INSERT INTO app.order_operational_audits
      (order_id,action,actor_type,actor_staff_member_id,reason_code,idempotency_key,metadata)
      VALUES ($1,$2,'OPS',$3,$4,$5,$6::jsonb)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        cancellation.order_id,
        refundStatus === 'FAILED'
          ? 'order_cancellation_refund_failed'
          : 'order_cancellation_refund_succeeded',
        session.staffMemberId,
        cancellation.reason_code,
        receiptKey,
        JSON.stringify({
          cancellationId: cancellation.id,
          destination: cancellation.refund_destination,
          amountCents: cancellation.refund_amount_cents,
          refundId: refund?.id ?? null,
          refundStatus,
          failureReason,
          note: cancellation.staff_note,
          source: 'ADMIN',
        }),
      ],
    );
  }

  private async cancelProviderGroups(
    client: SqlClient,
    session: AdminStaffSession,
    orderNumber: string,
    cancellation: CancellationRow,
    fulfillment: FulfillmentService,
  ): Promise<void> {
    const groups = await client.query<CancellationGroupRow>(
      `SELECT attempt.id,attempt.fulfillment_group_id,
        COALESCE(attempt.external_order_id,group_row.external_order_id) AS external_order_id,
        attempt.status,attempt.attempt_count,attempt.provider_error_code
      FROM app.order_cancellation_groups attempt
      JOIN app.order_fulfillment_groups group_row ON group_row.id=attempt.fulfillment_group_id
      WHERE attempt.order_cancellation_id=$1 AND attempt.status NOT IN ('CANCELLED','NOT_REQUIRED')
      ORDER BY attempt.fulfillment_group_id`,
      [cancellation.id],
    );
    for (const group of groups.rows) {
      const idempotencyKey = `cancel:${cancellation.id}:${group.fulfillment_group_id}`;
      // Losing the DB session does not stop a provider POST already in flight. The
      // durable started/no-result distinction survives that loss even when a new worker
      // has the advisory claim. An unchanged GET is not proof that another POST is safe.
      const reconcileOnly =
        group.status === 'REQUESTED' &&
        (group.attempt_count > 0 || group.provider_error_code === 'CANCELLATION_OUTCOME_UNKNOWN');
      const eligible = await transactionOn(client, async () => {
        const order = await this.lockOrder(client, orderNumber);
        const eligibility = await this.loadEligibility(client, session, order);
        if (reconcileOnly) return true;
        if (!eligibility.actions.cancel) {
          await client.query(
            `UPDATE app.order_cancellation_groups SET status='FAILED',provider_error_code='ORDER_NO_LONGER_ELIGIBLE',
            updated_at=now(),response_metadata=$2::jsonb WHERE id=$1`,
            [group.id, JSON.stringify({ idempotencyKey })],
          );
          return false;
        }
        await client.query(
          `UPDATE app.order_cancellation_groups SET status='REQUESTED',attempt_count=attempt_count+1,
          last_attempt_at=now(),updated_at=now(),response_metadata=$2::jsonb WHERE id=$1`,
          [group.id, JSON.stringify({ idempotencyKey })],
        );
        return true;
      });
      if (!eligible) continue;
      let state: CancellationGroupRow['status'];
      let errorCode: string | null = null;
      let occurredAt: Date | null = null;
      let reconciliationErrorCode: string | null = null;
      let readOnlyRecoveryRequired = reconcileOnly;
      try {
        if (reconcileOnly) {
          if (group.external_order_id === null) {
            state = 'REQUESTED';
            errorCode = 'CANCELLATION_OUTCOME_UNKNOWN';
            reconciliationErrorCode = 'EXTERNAL_ORDER_ID_UNRESOLVED';
          } else {
            const response = await fulfillment.getOrderStatus({
              externalOrderId: group.external_order_id,
            });
            state =
              response.externalOrderId === group.external_order_id &&
              ['cancelled', 'canceled'].includes(response.state.trim().toLowerCase())
                ? 'CANCELLED'
                : 'REQUESTED';
            occurredAt = state === 'CANCELLED' ? response.occurredAt : null;
            if (state === 'REQUESTED') errorCode = 'CANCELLATION_OUTCOME_UNKNOWN';
          }
        } else {
          const response = await fulfillment.cancelOrder({
            externalOrderId: group.external_order_id!,
            idempotencyKey,
          });
          state = response.state;
          occurredAt = response.occurredAt;
        }
      } catch (error) {
        const normalized = normalizeFulfillmentError(error);
        const ambiguousTransport =
          !reconcileOnly && ['TIMEOUT', 'NETWORK_ERROR'].includes(normalized.code);
        readOnlyRecoveryRequired = reconcileOnly || ambiguousTransport;
        state = readOnlyRecoveryRequired ? 'REQUESTED' : 'FAILED';
        if (readOnlyRecoveryRequired) {
          errorCode = 'CANCELLATION_OUTCOME_UNKNOWN';
          reconciliationErrorCode = normalized.code;
        } else errorCode = normalized.code;
      }
      await transactionOn(client, async () => {
        await this.lockOrder(client, orderNumber);
        await client.query('SELECT id FROM app.order_fulfillment_groups WHERE id=$1 FOR UPDATE', [
          group.fulfillment_group_id,
        ]);
        await client.query(
          `UPDATE app.order_cancellation_groups SET status=$2,provider_error_code=$3,
          response_metadata=response_metadata || $4::jsonb,
          external_order_id=COALESCE(external_order_id,$5),updated_at=now()
          WHERE id=$1`,
          [
            group.id,
            state,
            errorCode,
            JSON.stringify({
              idempotencyKey,
              occurredAt,
              ...(readOnlyRecoveryRequired
                ? {
                    reconciliation: 'READ_ONLY',
                    requiresManualResolution: state === 'REQUESTED',
                    reconciliationErrorCode,
                  }
                : {}),
            }),
            group.external_order_id,
          ],
        );
        await client.query(
          `INSERT INTO app.order_operational_audits
          (order_id,action,actor_type,actor_staff_member_id,reason_code,metadata)
          VALUES ($1,'order_cancellation_group_result','OPS',$2,$3,$4::jsonb)`,
          [
            cancellation.order_id,
            session.staffMemberId,
            cancellation.reason_code,
            JSON.stringify({
              cancellationId: cancellation.id,
              fulfillmentGroupId: group.fulfillment_group_id,
              status: state,
              providerErrorCode: errorCode,
              idempotencyKey,
              ...(readOnlyRecoveryRequired
                ? { reconciliation: 'READ_ONLY', requiresManualResolution: state === 'REQUESTED' }
                : {}),
              note: cancellation.staff_note,
              source: 'ADMIN',
            }),
          ],
        );
      });
    }
  }

  private async cancellationResult(
    client: SqlClient,
    cancellationId: string,
    duplicate: boolean,
  ): Promise<CancelOrderResult> {
    const row = (
      await client.query<CancellationRow & { order_status: string }>(
        `SELECT c.*,o.status AS order_status
      FROM app.order_cancellations c JOIN app.orders o ON o.id=c.order_id WHERE c.id=$1`,
        [cancellationId],
      )
    ).rows[0]!;
    const unresolved = await client.query<{ fulfillment_group_id: string; ambiguous: boolean }>(
      `SELECT attempt.fulfillment_group_id,
        COALESCE(attempt.provider_error_code='CANCELLATION_OUTCOME_UNKNOWN',false) AS ambiguous
      FROM app.order_cancellation_groups attempt JOIN app.order_fulfillment_groups group_row ON group_row.id=attempt.fulfillment_group_id
      WHERE attempt.order_cancellation_id=$1 AND (attempt.status NOT IN ('CANCELLED','NOT_REQUIRED')
        OR group_row.printing_status IN ('SUBMITTING','IN_PRODUCTION','PRINTED')
        OR group_row.fulfillment_status NOT IN ('UNFULFILLED','CANCELLED'))
      ORDER BY attempt.fulfillment_group_id`,
      [cancellationId],
    );
    const refund = (
      await client.query<{ id: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' }>(
        'SELECT id,status FROM app.order_refunds WHERE idempotency_key=$1',
        [`cancellation-refund:${cancellationId}`],
      )
    ).rows[0];
    const failed =
      (
        await client.query(
          `SELECT id FROM app.order_operational_audits WHERE idempotency_key=$1
      AND action='order_cancellation_refund_failed'`,
          [`cancellation-refund-result:${cancellationId}`],
        )
      ).rows.length > 0;
    const refundStatus =
      row.refund_destination === 'LATER'
        ? 'LATER'
        : (refund?.status ?? (failed ? 'FAILED' : 'PENDING'));
    return {
      cancellationId,
      status: row.status,
      orderStatus: row.order_status,
      unresolvedFulfillmentGroupIds: unresolved.rows.map((group) => group.fulfillment_group_id),
      ambiguousFulfillmentGroupIds: unresolved.rows
        .filter((group) => group.ambiguous)
        .map((group) => group.fulfillment_group_id),
      duplicate,
      refund: {
        destination: row.refund_destination,
        amountCents: row.refund_amount_cents,
        status: refundStatus,
        refundId: refund?.id ?? null,
        retryable: refundStatus === 'FAILED',
      },
    };
  }

  private async setArchive(
    session: AdminStaffSession,
    input: ArchiveOrderInput,
    archived: boolean,
  ): Promise<ArchiveResult> {
    this.validate(session, input);
    const action = archived ? 'order_archived' : 'order_unarchived';
    return withTransaction(this.pool, async (client) => {
      const order = await this.lockOrder(client, input.orderNumber);
      const existing = await this.existingAction<StoredArchiveResult>(
        client,
        order.id,
        action,
        input.idempotencyKey,
      );
      if (existing) {
        // Replay the committed result, even if a later action changed the current marker.
        return {
          ...existing,
          archivedAt: existing.archivedAt === null ? null : new Date(existing.archivedAt),
          duplicate: true,
        };
      }
      const eligibility = await this.loadEligibility(client, session, order);
      if (!eligibility.actions[archived ? 'archive' : 'unarchive']) {
        throw new OrderAdminActionConflictError(
          archived ? 'This order is not eligible for archive.' : 'This order is not archived.',
          eligibility,
        );
      }
      const updated = await client.query<LockedOrder>(
        `UPDATE app.orders SET archived_at=CASE WHEN $2::boolean THEN now() ELSE NULL END,
           archived_by_staff_member_id=CASE WHEN $2::boolean THEN $3::uuid ELSE NULL END
         WHERE id=$1 RETURNING id,status,archived_at,archived_by_staff_member_id`,
        [order.id, archived, session.staffMemberId],
      );
      const after = updated.rows[0];
      if (!after) throw new OrderAdminActionNotFoundError('Order not found.');
      const result: StoredArchiveResult = {
        orderId: order.id,
        archived,
        archivedAt: after.archived_at?.toISOString() ?? null,
      };
      await this.audit(client, session, order.id, action, input, {
        before: archiveMetadata(order),
        after: archiveMetadata(after),
        result,
      });
      return { ...result, archivedAt: after.archived_at, duplicate: false };
    });
  }

  private validate(session: AdminStaffSession, input: ArchiveOrderInput): void {
    if (!session.staffMemberId || (session.role !== 'OWNER' && session.role !== 'OPERATIONS')) {
      throw new OrderAdminActionAccessError('Operations access is restricted.');
    }
    if (typeof input.orderNumber !== 'string' || !input.orderNumber.trim()) {
      throw new OrderAdminActionValidationError('An order number is required.');
    }
    if (typeof input.reasonCode !== 'string' || !input.reasonCode.trim()) {
      throw new OrderAdminActionValidationError('A reason code is required.');
    }
    if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 1000)) {
      throw new OrderAdminActionValidationError(
        'The internal note must be 1000 characters or fewer.',
      );
    }
    if (
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim().length < 12 ||
      input.idempotencyKey.length > 120
    ) {
      throw new OrderAdminActionValidationError(
        'Provide an idempotency key between 12 and 120 characters.',
      );
    }
  }

  private async lockOrder(client: SqlClient, orderNumber: string): Promise<LockedOrder> {
    const found = await client.query<LockedOrder>(
      `SELECT id,status,archived_at,archived_by_staff_member_id FROM app.orders
       WHERE order_number=$1 FOR UPDATE`,
      [orderNumber],
    );
    const order = found.rows[0];
    if (!order) throw new OrderAdminActionNotFoundError('Order not found.');
    return order;
  }

  private async existingAction<Result>(
    client: SqlClient,
    orderId: string,
    action: string,
    key: string,
  ): Promise<Result | null> {
    // The audit key is globally unique, including across different order locks.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`order-admin-action:${key}`]);
    const existing = await client.query<{
      order_id: string;
      action: string;
      metadata: { result: Result };
    }>(
      `SELECT order_id,action,metadata FROM app.order_operational_audits WHERE idempotency_key=$1`,
      [key],
    );
    const audit = existing.rows[0];
    if (!audit) return null;
    if (audit.order_id !== orderId || audit.action !== action) {
      throw new OrderAdminActionConflictError(
        'Idempotency key belongs to another order or action.',
      );
    }
    return audit.metadata.result;
  }

  private async loadEligibility(
    client: SqlClient,
    session: AdminStaffSession,
    order: LockedOrder,
  ): Promise<OrderActionEligibility> {
    // Provider state updates can lock groups independently. Read their latest state under those locks.
    const groups = await client.query<{
      printing_status: PrintingGroupState;
      fulfillment_status: FulfillmentState;
    }>(
      `SELECT printing_status,fulfillment_status FROM app.order_fulfillment_groups
       WHERE order_id=$1 ORDER BY id FOR UPDATE`,
      [order.id],
    );
    const evidence = await client.query<{
      fulfillment_status: FulfillmentState;
      payment_status: PaymentStateEvidence['paymentStatus'];
      paid_cents: number;
      refunded_cents: number;
      reserved_refund_cents: number;
      returnable_quantity: number;
    }>(
      `SELECT layers.fulfillment_status, payment.status AS payment_status,
         CASE WHEN payment.status='SUCCEEDED' THEN payment.amount_cents ELSE 0 END AS paid_cents,
         COALESCE((SELECT sum(amount_cents) FROM app.order_refunds
           WHERE order_id=orders.id AND status='SUCCEEDED'),0)::int AS refunded_cents,
         COALESCE((SELECT sum(amount_cents) FROM app.order_refunds
           WHERE order_id=orders.id AND status IN ('PENDING','SUCCEEDED')),0)::int AS reserved_refund_cents,
         COALESCE((SELECT sum(GREATEST(0,item.quantity-COALESCE((
           SELECT sum(return_item.quantity) FROM app.order_return_items return_item
           JOIN app.order_returns returned ON returned.id=return_item.order_return_id
           WHERE return_item.order_item_id=item.id AND returned.state<>'REJECTED'
         ),0))) FROM app.order_items item
         JOIN app.order_fulfillment_group_items assignment ON assignment.order_item_id=item.id
         JOIN app.order_fulfillment_groups group_row ON group_row.id=assignment.fulfillment_group_id
         WHERE item.order_id=orders.id AND group_row.fulfillment_status IN ('FULFILLED','DELIVERED')),0)::int AS returnable_quantity
       FROM app.orders orders
       LEFT JOIN app.payments payment ON payment.checkout_attempt_id=orders.checkout_attempt_id
       LEFT JOIN LATERAL (${adminOrderLayerSql()}) layers ON true
       WHERE orders.id=$1`,
      [order.id],
    );
    const row = evidence.rows[0];
    if (!row) throw new OrderAdminActionNotFoundError('Order not found.');
    // Only the canonical cancellation authority can make cancellation terminal for archive.
    const fulfillmentState =
      order.status === 'CANCELLED'
        ? 'CANCELLED'
        : row.fulfillment_status === 'CANCELLED'
          ? 'UNFULFILLED'
          : row.fulfillment_status;
    const eligibility = resolveOrderActionEligibility({
      role: session.role,
      paymentState: projectPaymentState({
        paymentStatus: row.payment_status,
        paidCents: row.paid_cents,
        refundedCents: row.refunded_cents,
      }),
      printingStates: groups.rows.map((group) => group.printing_status),
      fulfillmentState,
      archived: order.archived_at !== null,
      refundableCents: Math.max(0, row.paid_cents - row.reserved_refund_cents),
      returnableQuantity: row.returnable_quantity,
      hasShippedQuantity: groups.rows.some((group) =>
        ['PARTIALLY_FULFILLED', 'FULFILLED', 'DELIVERED'].includes(group.fulfillment_status),
      ),
    });
    const blocked = await client.query(
      `SELECT 1 FROM app.order_fulfillment_groups WHERE order_id=$1 AND (external_order_id IS NOT NULL OR printing_status IN ('SUBMITTING','SUBMITTED','IN_PRODUCTION','PRINTED') OR fulfillment_status<>'UNFULFILLED')
      UNION ALL SELECT 1 FROM app.external_fulfillment_orders WHERE order_id=$1
      UNION ALL SELECT 1 FROM app.order_fulfillment_actions WHERE order_id=$1 AND (status='PROCESSING' OR (action='CREATE_EXTERNAL_ORDER' AND (attempt_count>0 OR status<>'PENDING')))
       UNION ALL SELECT 1 FROM app.order_cancellations WHERE order_id=$1 AND (status IN ('REQUESTED','PROCESSING','PARTIAL','SUCCEEDED') OR EXISTS (SELECT 1 FROM app.order_cancellation_groups attempt WHERE attempt.order_cancellation_id=app.order_cancellations.id AND attempt.status='REQUESTED' AND (attempt.attempt_count>0 OR attempt.provider_error_code='CANCELLATION_OUTCOME_UNKNOWN'))) LIMIT 1`,
      [order.id],
    );
    if (
      blocked.rows.length ||
      [
        'CANCELLED',
        'SHIPPED',
        'DELIVERED',
        'PARTIALLY_SHIPPED',
        'IN_PRODUCTION',
        'SUBMITTED_TO_PRINTIFY',
      ].includes(order.status)
    ) {
      eligibility.editFields.items = false;
      eligibility.editFields.pricing = false;
      eligibility.editFields.shippingAddress = false;
    }
    return eligibility;
  }

  private async audit(
    client: SqlClient,
    session: AdminStaffSession,
    orderId: string,
    action: string,
    input: ArchiveOrderInput,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO app.order_operational_audits (order_id,action,actor_type,actor_staff_member_id,
         reason_code,idempotency_key,metadata) VALUES ($1,$2,'OPS',$3,$4,$5,$6::jsonb)`,
      [
        orderId,
        action,
        session.staffMemberId,
        input.reasonCode,
        input.idempotencyKey,
        JSON.stringify({ ...metadata, source: 'ADMIN', note: input.note ?? null }),
      ],
    );
  }
}

async function transactionOn<T>(client: SqlClient, operation: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await operation();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function archiveMetadata(order: LockedOrder) {
  return {
    archivedAt: order.archived_at?.toISOString() ?? null,
    archivedByStaffMemberId: order.archived_by_staff_member_id,
  };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function validateEdit(input: EditOrderInput) {
  const invalidMoney = [input.discountCents, input.shippingCents].some(
    (value) =>
      value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647),
  );
  const invalidItems =
    input.items !== undefined &&
    (!Array.isArray(input.items) ||
      !input.items.length ||
      input.items.length > 100 ||
      input.items.some(
        (item) =>
          !item ||
          typeof item.productVariantId !== 'string' ||
          !item.productVariantId.trim() ||
          (item.orderItemId !== undefined && !isUuid(item.orderItemId)) ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 99,
      ) ||
      new Set(
        input.items
          .filter((item) => item.orderItemId)
          .map((item) => item.orderItemId!.toLowerCase()),
      ).size !== input.items.filter((item) => item.orderItemId).length);
  const invalidEmail =
    input.customerEmail !== undefined &&
    (typeof input.customerEmail !== 'string' ||
      input.customerEmail.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(input.customerEmail.trim()));
  const invalidPhone =
    input.customerPhone !== undefined &&
    (typeof input.customerPhone !== 'string' ||
      (input.customerPhone !== '' && !/^[+0-9().\-\s]{7,25}$/.test(input.customerPhone.trim())));
  const invalidTags =
    input.tags !== undefined &&
    (!Array.isArray(input.tags) ||
      input.tags.length > 100 ||
      input.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 80));
  const invalidAddress =
    input.shippingAddress !== undefined &&
    (!input.shippingAddress ||
      ['recipientName', 'email', 'line1', 'city', 'stateCode', 'postalCode', 'countryCode'].some(
        (key) =>
          typeof (input.shippingAddress as unknown as Record<string, unknown>)[key] !== 'string',
      ));
  if (invalidMoney || invalidItems || invalidEmail || invalidPhone || invalidTags || invalidAddress)
    throw new OrderAdminActionValidationError(
      'Enter valid order fields, quantities and non-negative minor-unit prices.',
    );
}

async function editSnapshot(client: SqlClient, orderId: string) {
  const order = (
    await client.query<EditableOrderRow>('SELECT * FROM app.orders WHERE id=$1', [orderId])
  ).rows[0]!;
  const items = (
    await client.query<EditableItemRow>(
      'SELECT * FROM app.order_items WHERE order_id=$1 ORDER BY id FOR UPDATE',
      [orderId],
    )
  ).rows;
  const tags = (
    await client.query<{ value: string }>(
      'SELECT tag.value FROM app.order_tags tag JOIN app.order_tag_assignments assignment ON assignment.order_tag_id=tag.id WHERE assignment.order_id=$1 ORDER BY tag.value',
      [orderId],
    )
  ).rows.map((tag) => tag.value);
  const notes = (
    await client.query('SELECT * FROM app.order_notes WHERE order_id=$1 ORDER BY created_at,id', [
      orderId,
    ])
  ).rows;
  return { order, items, tags, notes };
}

function resolveEditedItem(price: RepricedOrderItem, items: EditableItemRow[]) {
  const candidates = price.orderItemId
    ? items.filter((item) => item.id === price.orderItemId!.toLowerCase())
    : items.filter((item) => item.product_model_id === price.productModelId);
  // New lines must inherit an unambiguous existing artwork/proof. No invented design provenance.
  if (candidates.length !== 1 || candidates[0]!.product_model_id !== price.productModelId)
    throw new OrderAdminActionValidationError(
      'Select an existing item with an unambiguous design for this product model.',
    );
  return { id: price.orderItemId?.toLowerCase() ?? randomUUID(), source: candidates[0]!, price };
}

function restoreReturnSummary(value: StoredReturnSummary): OrderReturnSummary {
  return { ...value, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}
