import { withTransaction, type SqlPool } from '@let-it-be/db';

import type { StaffSession } from './staff-identity';
import {
  aggregatePrintingState,
  projectFulfillmentState,
  projectPaymentState,
  type FulfillmentState,
  type OrderPrintingState,
  type PaymentState,
  type PrintingGroupState,
} from './order-detail-contracts';

export type OrderDetailStaffSession = Omit<StaffSession, 'token'>;

export class OrderDetailDataError extends Error {}

export interface PostalAddressSnapshot {
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  countryCode: string;
}

export interface OrderPricingSnapshot {
  unitRetailCents: number;
  quantity: number;
  discountCents: number;
  subtotalCents: number;
  customerShippingCents: number;
  freeShippingApplied: boolean;
  taxCents: number;
  totalCents: number;
  currency: 'USD';
  pricingVersion: string;
}

export interface OrderFinancialSummary {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  currency: 'USD';
}

export interface ProductionEconomics {
  retailRevenueCents: number;
  productionCostCents: number | null;
  providerShippingCostCents: number | null;
  providerFeesCents: number | null;
  grossMarginCents: number | null;
  grossMarginBasisPoints: number | null;
}

export interface AdminOrderItem {
  id: string;
  productName: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  sku: string;
  projectId: string;
  projectVersionId: string;
  mockupId: string;
}

export interface AdminOrderShipment {
  id: string;
  carrier: string | null;
  service: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  state: string;
  shippedAt: Date | null;
  deliveredAt: Date | null;
}

export interface AdminOrderGroupSummary {
  id: string;
  providerName: string;
  externalOrderId: string | null;
  printingState: PrintingGroupState;
  fulfillmentState: FulfillmentState;
  itemCount: number;
  shippingMethod: string | null;
  attentionRequired: boolean;
  lastProviderSyncAt: Date | null;
  items: AdminOrderItem[];
  shipments: AdminOrderShipment[];
}

export interface AdminOrderNote {
  id: string;
  body: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminOrderDetail {
  orderNumber: string;
  createdAt: Date;
  salesChannel: string;
  paymentState: PaymentState;
  printingState: OrderPrintingState;
  fulfillmentState: FulfillmentState;
  customer: {
    id: string | null;
    name: string;
    email: string;
    phone: string | null;
    orderCount: number;
  };
  shippingAddress: PostalAddressSnapshot;
  billingAddress: PostalAddressSnapshot;
  billingMatchesShipping: boolean;
  financials: OrderFinancialSummary;
  groups: AdminOrderGroupSummary[];
  notes: AdminOrderNote[];
  tags: string[];
}

export interface PrintingGroupDetail {
  id: string;
  orderNumber: string;
  providerName: string;
  externalOrderId: string | null;
  printingState: PrintingGroupState;
  fulfillmentState: FulfillmentState;
  createdAt: Date;
  submittedAt: Date | null;
  lastProviderSyncAt: Date | null;
  stale: boolean;
  readiness: {
    ready: boolean | null;
    blockers: string[];
    evaluatedAt: Date | null;
  };
  economics: ProductionEconomics;
  items: Array<
    AdminOrderItem & {
      prepressStatus: string;
      derivativeReady: boolean;
      proofApproved: boolean;
    }
  >;
  shipments: AdminOrderShipment[];
  events: Array<{
    id: string;
    fromState: string | null;
    toState: string;
    source: string;
    disposition: string;
    createdAt: Date;
  }>;
  permittedActions: string[];
}

export interface AdminOrderTimelineEvent {
  id: string;
  type: string;
  occurredAt: Date;
  source: 'CUSTOMER' | 'STAFF' | 'SYSTEM' | 'PAYMENT_PROVIDER' | 'PRINT_PROVIDER' | 'CARRIER';
  actorName: string | null;
  description: string;
  details: Record<string, string | number | boolean | null>;
}

export interface AdminOrderTimelinePage {
  events: AdminOrderTimelineEvent[];
  nextCursor: string | null;
}

interface BaseOrderRow {
  id: string;
  order_number: string;
  customer_profile_id: string | null;
  customer_email: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_order_count: number;
  owner_type: string;
  payment_status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | null;
  payment_amount_cents: number | null;
  payment_currency: string | null;
  refunded_cents: number;
  shipping_address_snapshot: unknown;
  billing_address_snapshot: unknown;
  pricing_snapshot: unknown;
  created_at: Date;
}

interface GroupRow {
  id: string;
  provider_name: string;
  external_order_id: string | null;
  printing_status: PrintingGroupState;
  fulfillment_status: FulfillmentState;
  shipping_snapshot: unknown;
  last_provider_sync_at: Date | null;
  created_at: Date;
}

interface ItemRow {
  group_id: string;
  id: string;
  product_name: string;
  color_name: string;
  size: string;
  quantity: number;
  unit_price_cents: number;
  product_variant_id: string;
  project_id: string;
  project_version_id: string;
  mockup_id: string;
}

interface ShipmentRow {
  group_id: string;
  id: string;
  carrier: string | null;
  service: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  status: string;
  shipped_at: Date | null;
  delivered_at: Date | null;
}

export class OrderDetailService {
  public constructor(
    private readonly pool: SqlPool,
    private readonly staleAfterMs = 30 * 60 * 1000,
  ) {}

  async getOrder(
    session: OrderDetailStaffSession,
    orderNumber: string,
  ): Promise<AdminOrderDetail | null> {
    assertOrderDetailAccess(session);
    const order = await this.baseOrder(orderNumber);
    if (!order) return null;
    const [groupRows, itemRows, shipmentRows, noteRows, tagRows] = await Promise.all([
      this.groups(order.id),
      this.items(order.id),
      this.shipments(order.id),
      this.pool.query<{
        id: string;
        body: string;
        actor_name: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT note.id, note.body, staff.normalized_email AS actor_name,
                note.created_at, note.updated_at
         FROM app.order_notes note
         JOIN app.staff_members staff ON staff.id = note.created_by_staff_member_id
         WHERE note.order_id = $1
         ORDER BY note.created_at DESC, note.id DESC`,
        [order.id],
      ),
      this.pool.query<{ value: string }>(
        `SELECT tag.value
         FROM app.order_tag_assignments assignment
         JOIN app.order_tags tag ON tag.id = assignment.order_tag_id
         WHERE assignment.order_id = $1
         ORDER BY lower(tag.value), tag.id`,
        [order.id],
      ),
    ]);
    const itemsByGroup = groupBy(itemRows, (item) => item.group_id);
    const shipmentsByGroup = groupBy(shipmentRows, (shipment) => shipment.group_id);
    const groups = groupRows.map((group) =>
      this.groupSummary(
        group,
        itemsByGroup.get(group.id) ?? [],
        shipmentsByGroup.get(group.id) ?? [],
      ),
    );
    const pricing = parseOrderPricingSnapshot(order.pricing_snapshot);
    const shippingAddress = parsePostalAddressSnapshot(order.shipping_address_snapshot);
    const billingAddress = parsePostalAddressSnapshot(order.billing_address_snapshot);
    const paidCents = order.payment_status === 'SUCCEEDED' ? (order.payment_amount_cents ?? 0) : 0;
    const refundedCents = order.refunded_cents;
    return {
      orderNumber: order.order_number,
      createdAt: order.created_at,
      salesChannel:
        order.owner_type === 'GUEST' || order.owner_type === 'USER' ? 'Online Store' : '—',
      paymentState: projectPaymentState({
        paymentStatus: order.payment_status,
        paidCents,
        refundedCents,
      }),
      printingState: aggregatePrintingState(groups.map((group) => group.printingState)),
      fulfillmentState: aggregateFulfillmentGroups(groups),
      customer: {
        id: order.customer_profile_id,
        name: order.customer_name?.trim() || shippingAddress.recipientName || order.customer_email,
        email: order.customer_email,
        phone: order.customer_phone,
        orderCount: order.customer_order_count,
      },
      shippingAddress,
      billingAddress,
      billingMatchesShipping: addressesMatch(shippingAddress, billingAddress),
      financials: {
        subtotalCents: pricing.subtotalCents,
        discountCents: pricing.discountCents,
        shippingCents: pricing.customerShippingCents,
        taxCents: pricing.taxCents,
        totalCents: pricing.totalCents,
        paidCents,
        refundedCents,
        currency: pricing.currency,
      },
      groups,
      notes: noteRows.rows.map((note) => ({
        id: note.id,
        body: note.body,
        createdByName: note.actor_name,
        createdAt: note.created_at,
        updatedAt: note.updated_at,
      })),
      tags: tagRows.rows.map((tag) => tag.value),
    };
  }

  async getPrintingGroup(
    session: OrderDetailStaffSession,
    orderNumber: string,
    groupId: string,
  ): Promise<PrintingGroupDetail | null> {
    assertOrderDetailAccess(session);
    const result = await this.pool.query<
      GroupRow & {
        order_id: string;
        order_number: string;
        production_economics_snapshot: unknown;
        readiness_ready: boolean | null;
        readiness_blockers: unknown;
        readiness_created_at: Date | null;
        submitted_at: Date | null;
      }
    >(
      `SELECT fulfillment_group.id, fulfillment_group.order_id, orders.order_number,
              provider.display_name AS provider_name, fulfillment_group.external_order_id,
              fulfillment_group.printing_status, fulfillment_group.fulfillment_status,
              fulfillment_group.shipping_snapshot, fulfillment_group.production_economics_snapshot,
              fulfillment_group.last_provider_sync_at, fulfillment_group.created_at,
              readiness.ready AS readiness_ready, readiness.blockers AS readiness_blockers,
              readiness.created_at AS readiness_created_at,
              submission.completed_at AS submitted_at
       FROM app.order_fulfillment_groups fulfillment_group
       JOIN app.orders orders ON orders.id = fulfillment_group.order_id
       JOIN app.print_providers provider ON provider.id = fulfillment_group.provider_id
       LEFT JOIN LATERAL (
         SELECT ready, blockers, created_at
         FROM app.order_fulfillment_group_readiness_evaluations evaluation
         WHERE evaluation.fulfillment_group_id = fulfillment_group.id
         ORDER BY created_at DESC, id DESC LIMIT 1
       ) readiness ON true
       LEFT JOIN LATERAL (
         SELECT completed_at
         FROM app.order_fulfillment_actions action
         WHERE action.fulfillment_group_id = fulfillment_group.id
           AND action.action = 'SUBMIT_TO_PRODUCTION' AND action.status = 'SUCCEEDED'
         ORDER BY completed_at DESC NULLS LAST, created_at DESC LIMIT 1
       ) submission ON true
       WHERE orders.order_number = $1 AND fulfillment_group.id = $2`,
      [orderNumber, groupId],
    );
    const group = result.rows[0];
    if (!group) return null;
    const [items, shipments, events] = await Promise.all([
      this.pool.query<
        ItemRow & { prepress_status: string; derivative_ready: boolean; proof_approved: boolean }
      >(
        `SELECT fulfillment_group.id AS group_id, item.id, model.display_name AS product_name,
                coalesce(item.item_snapshot->>'colorName', variant.color_name) AS color_name,
                coalesce(item.item_snapshot->>'size', variant.size) AS size,
                item.quantity,
                coalesce((item.item_snapshot->>'unitRetailCents')::int, variant.price_cents) AS unit_price_cents,
                item.product_variant_id, item.project_id, item.project_version_id, item.mockup_id,
                prepress.status AS prepress_status,
                (derivative.derivative_asset_id IS NOT NULL AND derivative.status = 'READY') AS derivative_ready,
                EXISTS (
                  SELECT 1 FROM app.proof_approvals proof
                  WHERE proof.cart_item_id = item.cart_item_id AND proof.approval_state = 'APPROVED'
                ) AS proof_approved
         FROM app.order_fulfillment_groups fulfillment_group
         JOIN app.order_fulfillment_group_items group_item ON group_item.fulfillment_group_id = fulfillment_group.id
         JOIN app.order_items item ON item.id = group_item.order_item_id
         JOIN app.product_models model ON model.id = item.product_model_id
         JOIN app.product_variants variant ON variant.id = item.product_variant_id
         JOIN app.prepress_runs prepress ON prepress.id = item.prepress_run_id
         LEFT JOIN LATERAL (
           SELECT status, derivative_asset_id
           FROM app.provider_derivatives derivative
           WHERE derivative.prepress_run_id = item.prepress_run_id
             AND derivative.qualification_id = fulfillment_group.qualification_id
           ORDER BY derivative.created_at DESC LIMIT 1
         ) derivative ON true
         WHERE fulfillment_group.id = $1
         ORDER BY item.created_at, item.id`,
        [groupId],
      ),
      this.pool.query<ShipmentRow>(
        `SELECT fulfillment_group_id AS group_id, id, carrier, service, tracking_number,
                tracking_url, status, shipped_at, delivered_at
         FROM app.order_shipments
         WHERE fulfillment_group_id = $1
         ORDER BY created_at, id`,
        [groupId],
      ),
      this.pool.query<{
        id: string;
        from_state: string | null;
        to_state: string;
        source: string;
        disposition: string;
        created_at: Date;
      }>(
        `SELECT id, from_state, to_state, source, disposition, created_at
         FROM app.order_printing_status_events
         WHERE fulfillment_group_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 50`,
        [groupId],
      ),
    ]);
    const orderItems = items.rows.map(toAdminOrderItem);
    const frozen = parseProductionEconomicsSnapshot(group.production_economics_snapshot);
    const retailRevenueCents = orderItems.reduce((total, item) => total + item.lineTotalCents, 0);
    const actions = permittedPrintingActions(
      session,
      group.printing_status,
      Boolean(group.external_order_id),
    );
    return {
      id: group.id,
      orderNumber: group.order_number,
      providerName: group.provider_name,
      externalOrderId: group.external_order_id,
      printingState: group.printing_status,
      fulfillmentState: group.fulfillment_status,
      createdAt: group.created_at,
      submittedAt: group.submitted_at,
      lastProviderSyncAt: group.last_provider_sync_at,
      stale:
        ['SUBMITTED', 'IN_PRODUCTION'].includes(group.printing_status) &&
        (!group.last_provider_sync_at ||
          Date.now() - group.last_provider_sync_at.getTime() > this.staleAfterMs),
      readiness: {
        ready: group.readiness_ready,
        blockers: parseStringArray(group.readiness_blockers),
        evaluatedAt: group.readiness_created_at,
      },
      economics: calculateProductionEconomics({
        retailRevenueCents: frozen.retailRevenueCents ?? retailRevenueCents,
        productionCostCents: frozen.productionCostCents,
        providerShippingCostCents:
          frozen.providerShippingCostCents ?? shippingCostFromSnapshot(group.shipping_snapshot),
        providerFeesCents: frozen.providerFeesCents,
      }),
      items: items.rows.map((item) => ({
        ...toAdminOrderItem(item),
        prepressStatus: item.prepress_status,
        derivativeReady: item.derivative_ready,
        proofApproved: item.proof_approved,
      })),
      shipments: shipments.rows.map(toAdminShipment),
      events: events.rows.map((event) => ({
        id: event.id,
        fromState: event.from_state,
        toState: event.to_state,
        source: event.source,
        disposition: event.disposition,
        createdAt: event.created_at,
      })),
      permittedActions: actions,
    };
  }

  async addOrderNote(
    session: OrderDetailStaffSession,
    orderNumber: string,
    body: string,
  ): Promise<AdminOrderNote> {
    assertOrderDetailMutationAccess(session);
    const normalizedBody = body.trim();
    if (!normalizedBody || normalizedBody.length > 5_000) {
      throw new OrderDetailDataError('Order notes must contain between 1 and 5000 characters.');
    }
    return withTransaction(this.pool, async (client) => {
      const order = await client.query<{ id: string }>(
        `SELECT id FROM app.orders WHERE order_number = $1 FOR UPDATE`,
        [orderNumber],
      );
      const orderId = order.rows[0]?.id;
      if (!orderId) throw new OrderDetailDataError('Order not found.');
      const inserted = await client.query<{
        id: string;
        body: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO app.order_notes (order_id, body, created_by_staff_member_id)
         VALUES ($1, $2, $3)
         RETURNING id, body, created_at, updated_at`,
        [orderId, normalizedBody, session.staffMemberId],
      );
      const note = requiredRow(inserted.rows[0], 'Could not add the order note.');
      await client.query(
        `INSERT INTO app.order_operational_audits (
           order_id, action, actor_type, actor_staff_member_id, metadata
         ) VALUES ($1, 'order_note_added', 'OPS', $2, $3::jsonb)`,
        [orderId, session.staffMemberId, JSON.stringify({ noteId: note.id })],
      );
      return {
        id: note.id,
        body: note.body,
        createdByName: session.email,
        createdAt: note.created_at,
        updatedAt: note.updated_at,
      };
    });
  }

  async replaceOrderTags(
    session: OrderDetailStaffSession,
    orderNumber: string,
    values: string[],
  ): Promise<string[]> {
    assertOrderDetailMutationAccess(session);
    const canonical = canonicalTags(values);
    return withTransaction(this.pool, async (client) => {
      const order = await client.query<{ id: string }>(
        `SELECT id FROM app.orders WHERE order_number = $1 FOR UPDATE`,
        [orderNumber],
      );
      const orderId = order.rows[0]?.id;
      if (!orderId) throw new OrderDetailDataError('Order not found.');
      const previous = await client.query<{ value: string }>(
        `SELECT tag.value
         FROM app.order_tag_assignments assignment
         JOIN app.order_tags tag ON tag.id = assignment.order_tag_id
         WHERE assignment.order_id = $1`,
        [orderId],
      );
      const tagIds: string[] = [];
      for (const value of canonical) {
        await client.query(
          `INSERT INTO app.order_tags (value) VALUES ($1) ON CONFLICT DO NOTHING`,
          [value],
        );
        const tag = await client.query<{ id: string; value: string }>(
          `SELECT id, value FROM app.order_tags WHERE lower(value) = lower($1)`,
          [value],
        );
        const persisted = requiredRow(tag.rows[0], 'Could not persist the order tag.');
        tagIds.push(persisted.id);
      }
      await client.query(`DELETE FROM app.order_tag_assignments WHERE order_id = $1`, [orderId]);
      for (const tagId of tagIds) {
        await client.query(
          `INSERT INTO app.order_tag_assignments (
             order_id, order_tag_id, created_by_staff_member_id
           ) VALUES ($1, $2, $3)`,
          [orderId, tagId, session.staffMemberId],
        );
      }
      const previousValues = previous.rows.map((tag) => tag.value);
      const previousKeys = new Set(previousValues.map((value) => value.toLowerCase()));
      const nextKeys = new Set(canonical.map((value) => value.toLowerCase()));
      await client.query(
        `INSERT INTO app.order_operational_audits (
           order_id, action, actor_type, actor_staff_member_id, metadata
         ) VALUES ($1, 'order_tags_replaced', 'OPS', $2, $3::jsonb)`,
        [
          orderId,
          session.staffMemberId,
          JSON.stringify({
            added: canonical.filter((value) => !previousKeys.has(value.toLowerCase())),
            removed: previousValues.filter((value) => !nextKeys.has(value.toLowerCase())),
          }),
        ],
      );
      return canonical;
    });
  }

  async listOrderTags(session: OrderDetailStaffSession, orderNumber: string): Promise<string[]> {
    assertOrderDetailAccess(session);
    const result = await this.pool.query<{ value: string }>(
      `SELECT tag.value
       FROM app.order_tag_assignments assignment
       JOIN app.order_tags tag ON tag.id = assignment.order_tag_id
       JOIN app.orders orders ON orders.id = assignment.order_id
       WHERE orders.order_number = $1
       ORDER BY lower(tag.value), tag.id`,
      [orderNumber],
    );
    return result.rows.map((tag) => tag.value);
  }

  async listTimeline(
    session: OrderDetailStaffSession,
    orderNumber: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<AdminOrderTimelinePage> {
    assertOrderDetailAccess(session);
    const limit = Math.min(50, Math.max(1, Math.floor(options.limit ?? 10)));
    const cursor = options.cursor ? decodeTimelineCursor(options.cursor) : null;
    const result = await this.pool.query<{
      id: string;
      type: string;
      occurred_at: Date;
      source: AdminOrderTimelineEvent['source'];
      actor_name: string | null;
      description: string;
      details: unknown;
    }>(
      `WITH target_order AS (
         SELECT id, checkout_attempt_id, created_at FROM app.orders WHERE order_number = $1
       ), timeline AS (
         SELECT 'order:' || orders.id AS id, 'ORDER_CREATED'::text AS type,
                orders.created_at AS occurred_at, 'CUSTOMER'::text AS source,
                NULL::text AS actor_name, 'Order placed'::text AS description,
                jsonb_build_object('orderNumber', $1::text) AS details
         FROM target_order orders
         UNION ALL
         SELECT 'state:' || history.id, 'ORDER_STATE_CHANGED', history.created_at,
                CASE WHEN history.actor_type = 'CUSTOMER' THEN 'CUSTOMER'
                     WHEN history.actor_type = 'OPS' THEN 'STAFF' ELSE 'SYSTEM' END,
                staff.normalized_email,
                'Order state changed to ' || replace(lower(history.to_state), '_', ' '),
                jsonb_build_object('fromState', history.from_state, 'toState', history.to_state,
                                   'reasonCode', history.reason_code)
         FROM app.order_state_history history
         JOIN target_order orders ON orders.id = history.order_id
         LEFT JOIN app.staff_members staff ON staff.id = history.actor_staff_member_id
         UNION ALL
         SELECT 'payment:' || payment.id, 'PAYMENT_' || payment.status, payment.created_at,
                'PAYMENT_PROVIDER', NULL,
                'Payment ' || replace(lower(payment.status), '_', ' '),
                jsonb_build_object('amountCents', payment.amount_cents, 'currency', payment.currency)
         FROM app.payments payment
         JOIN target_order orders ON orders.checkout_attempt_id = payment.checkout_attempt_id
         UNION ALL
         SELECT 'refund:' || refund.id, 'REFUND_' || refund.status, refund.created_at,
                'PAYMENT_PROVIDER', NULL,
                'Refund ' || replace(lower(refund.status), '_', ' '),
                jsonb_build_object('amountCents', refund.amount_cents, 'reasonCode', refund.reason_code)
         FROM app.order_refunds refund JOIN target_order orders ON orders.id = refund.order_id
         UNION ALL
         SELECT 'printing:' || event.id, 'PRINTING_STATE_CHANGED', event.created_at,
                CASE WHEN event.source = 'OPS' THEN 'STAFF'
                     WHEN event.source IN ('WEBHOOK','POLLING') THEN 'PRINT_PROVIDER'
                     ELSE 'SYSTEM' END,
                staff.normalized_email,
                'Printing state changed to ' || replace(lower(event.to_state), '_', ' '),
                jsonb_build_object('fromState', event.from_state, 'toState', event.to_state,
                                   'disposition', event.disposition)
         FROM app.order_printing_status_events event
         JOIN target_order orders ON orders.id = event.order_id
         LEFT JOIN app.staff_members staff ON staff.id = event.actor_staff_member_id
         UNION ALL
         SELECT 'fulfillment:' || history.id, 'FULFILLMENT_STATE_CHANGED', history.created_at,
                CASE WHEN history.source = 'OPS' THEN 'STAFF'
                     WHEN history.source IN ('WEBHOOK','POLLING') THEN 'CARRIER'
                     ELSE 'SYSTEM' END,
                staff.normalized_email,
                'Fulfillment state changed to ' || replace(lower(history.to_state), '_', ' '),
                jsonb_build_object('fromState', history.from_state, 'toState', history.to_state)
         FROM app.order_fulfillment_status_history history
         JOIN target_order orders ON orders.id = history.order_id
         LEFT JOIN app.staff_members staff ON staff.id = history.actor_staff_member_id
         UNION ALL
         SELECT 'shipment:' || shipment.id, 'SHIPMENT_' || shipment.status, shipment.updated_at,
                'CARRIER', NULL,
                'Shipment ' || replace(lower(shipment.status), '_', ' '),
                jsonb_build_object('carrier', shipment.carrier, 'trackingNumber', shipment.tracking_number)
         FROM app.order_shipments shipment JOIN target_order orders ON orders.id = shipment.order_id
         UNION ALL
         SELECT 'note:' || note.id, 'ORDER_NOTE_ADDED', note.created_at,
                'STAFF', staff.normalized_email, 'Order note added',
                jsonb_build_object('noteId', note.id)
         FROM app.order_notes note
         JOIN target_order orders ON orders.id = note.order_id
         JOIN app.staff_members staff ON staff.id = note.created_by_staff_member_id
         UNION ALL
         SELECT 'audit:' || audit.id,
                CASE WHEN audit.action = 'order_tags_replaced' THEN 'ORDER_TAGS_CHANGED'
                     ELSE 'OPERATIONAL_ACTION' END,
                audit.created_at,
                CASE WHEN audit.actor_type = 'OPS' THEN 'STAFF'
                     WHEN audit.actor_type IN ('WEBHOOK','POLLING') THEN 'PRINT_PROVIDER'
                     ELSE 'SYSTEM' END,
                staff.normalized_email,
                CASE WHEN audit.action = 'order_tags_replaced' THEN 'Order tags changed'
                     ELSE replace(lower(audit.action), '_', ' ') END,
                jsonb_build_object('action', audit.action, 'reasonCode', audit.reason_code)
         FROM app.order_operational_audits audit
         JOIN target_order orders ON orders.id = audit.order_id
         LEFT JOIN app.staff_members staff ON staff.id = audit.actor_staff_member_id
         UNION ALL
         SELECT 'delivery:' || delivery.id, 'MESSAGE_' || delivery.status, delivery.updated_at,
                'SYSTEM', NULL,
                replace(lower(delivery.message_type), '_', ' ') || ' email ' || lower(delivery.status),
                jsonb_build_object('messageType', delivery.message_type,
                                   'classification', delivery.classification,
                                   'status', delivery.status)
         FROM app.lifecycle_deliveries delivery
         JOIN target_order orders ON orders.id = delivery.order_id
       )
       SELECT id, type, occurred_at, source, actor_name, description, details
       FROM timeline
       WHERE ($2::timestamptz IS NULL OR (occurred_at, id) < ($2::timestamptz, $3::text))
       ORDER BY occurred_at DESC, id DESC
       LIMIT $4`,
      [orderNumber, cursor?.occurredAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const hasNextPage = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const events = rows.map((event) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.occurred_at,
      source: event.source,
      actorName: event.actor_name,
      description: event.description,
      details: safeTimelineDetails(event.details),
    }));
    const last = rows.at(-1);
    return {
      events,
      nextCursor:
        hasNextPage && last
          ? encodeTimelineCursor({ occurredAt: last.occurred_at.toISOString(), id: last.id })
          : null,
    };
  }

  private async baseOrder(orderNumber: string): Promise<BaseOrderRow | null> {
    const result = await this.pool.query<BaseOrderRow>(
      `SELECT orders.id, orders.order_number, orders.customer_profile_id, orders.customer_email,
              nullif(trim(concat_ws(' ', customer.first_name, customer.last_name)), '') AS customer_name,
              customer.phone AS customer_phone,
              CASE WHEN orders.customer_profile_id IS NULL THEN 1 ELSE (
                SELECT count(*)::int FROM app.orders customer_order
                WHERE customer_order.customer_profile_id = orders.customer_profile_id
              ) END AS customer_order_count,
              orders.owner_type, payment.status AS payment_status,
              payment.amount_cents AS payment_amount_cents, payment.currency AS payment_currency,
              coalesce((SELECT sum(refund.amount_cents)::int FROM app.order_refunds refund
                        WHERE refund.order_id = orders.id AND refund.status = 'SUCCEEDED'), 0) AS refunded_cents,
              orders.shipping_address_snapshot, orders.billing_address_snapshot,
              orders.pricing_snapshot, orders.created_at
       FROM app.orders orders
       LEFT JOIN app.customer_profiles customer ON customer.id = orders.customer_profile_id
       LEFT JOIN app.payments payment ON payment.checkout_attempt_id = orders.checkout_attempt_id
       WHERE orders.order_number = $1`,
      [orderNumber],
    );
    return result.rows[0] ?? null;
  }

  private async groups(orderId: string): Promise<GroupRow[]> {
    return (
      await this.pool.query<GroupRow>(
        `SELECT fulfillment_group.id, provider.display_name AS provider_name,
                fulfillment_group.external_order_id, fulfillment_group.printing_status,
                fulfillment_group.fulfillment_status, fulfillment_group.shipping_snapshot,
                fulfillment_group.last_provider_sync_at, fulfillment_group.created_at
         FROM app.order_fulfillment_groups fulfillment_group
         JOIN app.print_providers provider ON provider.id = fulfillment_group.provider_id
         WHERE fulfillment_group.order_id = $1
         ORDER BY fulfillment_group.created_at, fulfillment_group.id`,
        [orderId],
      )
    ).rows;
  }

  private async items(orderId: string): Promise<ItemRow[]> {
    return (
      await this.pool.query<ItemRow>(
        `SELECT group_item.fulfillment_group_id AS group_id, item.id,
                model.display_name AS product_name,
                coalesce(item.item_snapshot->>'colorName', variant.color_name) AS color_name,
                coalesce(item.item_snapshot->>'size', variant.size) AS size,
                item.quantity,
                coalesce((item.item_snapshot->>'unitRetailCents')::int, variant.price_cents) AS unit_price_cents,
                item.product_variant_id, item.project_id, item.project_version_id, item.mockup_id
         FROM app.order_items item
         JOIN app.order_fulfillment_group_items group_item ON group_item.order_item_id = item.id
         JOIN app.product_models model ON model.id = item.product_model_id
         JOIN app.product_variants variant ON variant.id = item.product_variant_id
         WHERE item.order_id = $1
         ORDER BY item.created_at, item.id`,
        [orderId],
      )
    ).rows;
  }

  private async shipments(orderId: string): Promise<ShipmentRow[]> {
    return (
      await this.pool.query<ShipmentRow>(
        `SELECT fulfillment_group_id AS group_id, id, carrier, service, tracking_number,
                tracking_url, status, shipped_at, delivered_at
         FROM app.order_shipments
         WHERE order_id = $1 AND fulfillment_group_id IS NOT NULL
         ORDER BY created_at, id`,
        [orderId],
      )
    ).rows;
  }

  private groupSummary(
    group: GroupRow,
    items: ItemRow[],
    shipments: ShipmentRow[],
  ): AdminOrderGroupSummary {
    return {
      id: group.id,
      providerName: group.provider_name,
      externalOrderId: group.external_order_id,
      printingState: group.printing_status,
      fulfillmentState: group.fulfillment_status,
      itemCount: items.reduce((total, item) => total + item.quantity, 0),
      shippingMethod: stringFromRecord(group.shipping_snapshot, 'method'),
      attentionRequired:
        ['FAILED', 'ON_HOLD'].includes(group.printing_status) ||
        (['SUBMITTED', 'IN_PRODUCTION'].includes(group.printing_status) &&
          (!group.last_provider_sync_at ||
            Date.now() - group.last_provider_sync_at.getTime() > this.staleAfterMs)),
      lastProviderSyncAt: group.last_provider_sync_at,
      items: items.map(toAdminOrderItem),
      shipments: shipments.map(toAdminShipment),
    };
  }
}

export function parseOrderPricingSnapshot(value: unknown): OrderPricingSnapshot {
  const record = requireRecord(value, 'Order pricing snapshot');
  const snapshot: OrderPricingSnapshot = {
    unitRetailCents: integerField(record, 'unitRetailCents'),
    quantity: integerField(record, 'quantity'),
    discountCents: integerField(record, 'discountCents'),
    subtotalCents: integerField(record, 'subtotalCents'),
    customerShippingCents: integerField(record, 'customerShippingCents'),
    freeShippingApplied: booleanField(record, 'freeShippingApplied'),
    taxCents: integerField(record, 'taxCents'),
    totalCents: integerField(record, 'totalCents'),
    currency: literalUsd(record.currency),
    pricingVersion: stringField(record, 'pricingVersion'),
  };
  if (
    snapshot.quantity < 1 ||
    snapshot.unitRetailCents < 0 ||
    snapshot.discountCents < 0 ||
    snapshot.subtotalCents < 0 ||
    snapshot.customerShippingCents < 0 ||
    snapshot.taxCents < 0 ||
    snapshot.totalCents < 0
  ) {
    throw new OrderDetailDataError('Order pricing snapshot contains invalid amounts.');
  }
  return snapshot;
}

export function parsePostalAddressSnapshot(value: unknown): PostalAddressSnapshot {
  const record = requireRecord(value, 'Postal address snapshot');
  return {
    recipientName: stringField(record, 'recipientName'),
    line1: stringField(record, 'line1'),
    line2: nullableStringField(record, 'line2'),
    city: stringField(record, 'city'),
    stateCode: stringField(record, 'stateCode'),
    postalCode: stringField(record, 'postalCode'),
    countryCode: stringField(record, 'countryCode'),
  };
}

export function calculateProductionEconomics(input: {
  retailRevenueCents: number;
  productionCostCents: number | null;
  providerShippingCostCents: number | null;
  providerFeesCents: number | null;
}): ProductionEconomics {
  const complete =
    input.productionCostCents !== null &&
    input.providerShippingCostCents !== null &&
    input.providerFeesCents !== null;
  const grossMarginCents = complete
    ? input.retailRevenueCents -
      input.productionCostCents! -
      input.providerShippingCostCents! -
      input.providerFeesCents!
    : null;
  return {
    ...input,
    grossMarginCents,
    grossMarginBasisPoints:
      grossMarginCents === null || input.retailRevenueCents === 0
        ? null
        : Math.round((grossMarginCents / input.retailRevenueCents) * 10_000),
  };
}

function toAdminOrderItem(item: ItemRow): AdminOrderItem {
  return {
    id: item.id,
    productName: item.product_name,
    color: item.color_name,
    size: item.size,
    quantity: item.quantity,
    unitPriceCents: item.unit_price_cents,
    lineTotalCents: item.unit_price_cents * item.quantity,
    sku: item.product_variant_id,
    projectId: item.project_id,
    projectVersionId: item.project_version_id,
    mockupId: item.mockup_id,
  };
}

function toAdminShipment(shipment: ShipmentRow): AdminOrderShipment {
  return {
    id: shipment.id,
    carrier: shipment.carrier,
    service: shipment.service,
    trackingNumber: shipment.tracking_number,
    trackingUrl: shipment.tracking_url,
    state: shipment.status,
    shippedAt: shipment.shipped_at,
    deliveredAt: shipment.delivered_at,
  };
}

function aggregateFulfillmentGroups(groups: AdminOrderGroupSummary[]): FulfillmentState {
  if (!groups.length) return 'UNFULFILLED';
  if (groups.every((group) => group.fulfillmentState === 'CANCELLED')) return 'CANCELLED';
  return projectFulfillmentState({
    totalQuantity: groups.reduce((total, group) => total + group.itemCount, 0),
    fulfilledQuantity: groups
      .filter((group) => ['FULFILLED', 'DELIVERED'].includes(group.fulfillmentState))
      .reduce((total, group) => total + group.itemCount, 0),
    deliveredQuantity: groups
      .filter((group) => group.fulfillmentState === 'DELIVERED')
      .reduce((total, group) => total + group.itemCount, 0),
    cancelledQuantity: groups
      .filter((group) => group.fulfillmentState === 'CANCELLED')
      .reduce((total, group) => total + group.itemCount, 0),
  });
}

function permittedPrintingActions(
  session: OrderDetailStaffSession,
  state: PrintingGroupState,
  hasExternalOrder: boolean,
): string[] {
  if (session.role === 'READ_ONLY') return [];
  if (state === 'READY_FOR_PRODUCTION') return ['SUBMIT'];
  if (state === 'FAILED') return ['RETRY', 'HOLD', 'MANUAL_RECONCILE'];
  if (state === 'ON_HOLD') return ['RESUME'];
  if (hasExternalOrder && ['SUBMITTED', 'IN_PRODUCTION'].includes(state))
    return ['HOLD', 'MANUAL_RECONCILE'];
  return [];
}

function parseProductionEconomicsSnapshot(value: unknown): {
  retailRevenueCents: number | null;
  productionCostCents: number | null;
  providerShippingCostCents: number | null;
  providerFeesCents: number | null;
} {
  const record = isRecord(value) ? value : {};
  return {
    retailRevenueCents: optionalInteger(record.retailRevenueCents),
    productionCostCents: optionalInteger(record.productionCostCents),
    providerShippingCostCents: optionalInteger(record.providerShippingCostCents),
    providerFeesCents: optionalInteger(record.providerFeesCents),
  };
}

function shippingCostFromSnapshot(value: unknown): number | null {
  const record = isRecord(value) ? value : {};
  return optionalInteger(record.shippingCents);
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function addressesMatch(a: PostalAddressSnapshot, b: PostalAddressSnapshot): boolean {
  return (Object.keys(a) as Array<keyof PostalAddressSnapshot>).every(
    (key) => (a[key] ?? '').toLowerCase() === (b[key] ?? '').toLowerCase(),
  );
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), value]);
  }
  return grouped;
}

function assertOrderDetailAccess(session: OrderDetailStaffSession): void {
  if (!session.staffMemberId) throw new Error('Admin access is restricted.');
}

function assertOrderDetailMutationAccess(session: OrderDetailStaffSession): void {
  assertOrderDetailAccess(session);
  if (session.role === 'READ_ONLY') throw new Error('This staff role has read-only access.');
}

function canonicalTags(values: string[]): string[] {
  if (values.length > 50) throw new OrderDetailDataError('An order can have at most 50 tags.');
  const canonical = new Map<string, string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    if (value.length > 80)
      throw new OrderDetailDataError('Order tags cannot exceed 80 characters.');
    const key = value.toLowerCase();
    if (!canonical.has(key)) canonical.set(key, value);
  }
  return [...canonical.values()].sort((left, right) =>
    left.localeCompare(right, 'en', { sensitivity: 'base' }),
  );
}

function encodeTimelineCursor(cursor: { occurredAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeTimelineCursor(value: string): { occurredAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.occurredAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.occurredAt)) ||
      typeof parsed.id !== 'string' ||
      !parsed.id
    ) {
      throw new Error('invalid');
    }
    return { occurredAt: new Date(parsed.occurredAt), id: parsed.id };
  } catch {
    throw new OrderDetailDataError('Timeline cursor is invalid.');
  }
}

function safeTimelineDetails(value: unknown): Record<string, string | number | boolean | null> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string | number | boolean | null] =>
        entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1]),
    ),
  );
}

function requiredRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new OrderDetailDataError(message);
  return row;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new OrderDetailDataError(`${label} is invalid.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function integerField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isInteger(value)) throw new OrderDetailDataError(`${key} must be an integer.`);
  return value as number;
}

function optionalInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim())
    throw new OrderDetailDataError(`${key} must be a non-empty string.`);
  return value;
}

function nullableStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new OrderDetailDataError(`${key} must be a string.`);
  return value;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new OrderDetailDataError(`${key} must be a boolean.`);
  return value;
}

function literalUsd(value: unknown): 'USD' {
  if (value !== 'USD') throw new OrderDetailDataError('Order currency must be USD.');
  return value;
}

function stringFromRecord(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : null;
}
