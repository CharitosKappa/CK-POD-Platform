import type { SqlPool } from '@let-it-be/db';

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
