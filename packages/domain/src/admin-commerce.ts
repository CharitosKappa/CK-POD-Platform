import type { SqlPool } from '@let-it-be/db';

import type { StaffSession } from './staff-identity';
import {
  adminFulfillmentStatuses,
  adminOrderSorts,
  adminOrderViews,
  adminPaymentStatuses,
  adminPrintingStatuses,
  type AdminOrderListOptions,
  type AdminOrderSort,
} from './admin-order-contracts';

export type AdminStaffSession = Omit<StaffSession, 'token'>;

export interface AdminOrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  customerEmail: string;
  customerName: string;
  productName: string;
  itemCount: number;
  totalCents: number;
  paymentStatus: string;
  printingStatus: string;
  fulfillmentStatus: string;
  currency: string;
  createdAt: Date;
}

export interface AdminCommerceDashboard {
  metrics: {
    grossSalesCents: number;
    orders: number;
    averageOrderValueCents: number;
    customers: number;
    returningCustomers: number;
  };
  attention: {
    needsReview: number;
    readyToSubmit: number;
    onHold: number;
    failed: number;
  };
  recentOrders: AdminOrderSummary[];
  bestSellers: Array<{ productName: string; units: number; orders: number }>;
}

export interface AdminOrderList {
  orders: AdminOrderSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminOrderFilterQuery {
  predicates: string[];
  values: unknown[];
}

export interface AdminOrderCommerceDetail extends AdminOrderSummary {
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
  items: Array<{
    productName: string;
    color: string;
    size: string;
    quantity: number;
  }>;
}

export class AdminCommerceValidationError extends Error {}

export class AdminCommerceService {
  public constructor(private readonly pool: SqlPool) {}

  async dashboard(session: AdminStaffSession): Promise<AdminCommerceDashboard> {
    assertStaffRead(session);
    const [metrics, attention, recentOrders, bestSellers] = await Promise.all([
      this.pool.query<{
        gross_sales_cents: string;
        order_count: string;
        customer_count: string;
        returning_customers: string;
      }>(
        `SELECT
           COALESCE((SELECT sum((pricing_snapshot ->> 'totalCents')::bigint)
                     FROM app.orders WHERE created_at >= now() - interval '30 days'), 0)::text AS gross_sales_cents,
           (SELECT count(*) FROM app.orders
            WHERE created_at >= now() - interval '30 days')::text AS order_count,
           (SELECT count(*) FROM app.customer_profiles)::text AS customer_count,
           (SELECT count(*) FROM (
              SELECT lower(trim(customer_email)) FROM app.orders
              GROUP BY lower(trim(customer_email)) HAVING count(*) > 1
            ) returning_set)::text AS returning_customers`,
      ),
      this.pool.query<{
        needs_review: string;
        ready_to_submit: string;
        on_hold: string;
        failed: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE status IN ('PAID','PREPRESS_REVIEW','COMPLIANCE_REVIEW','ROUTING'))::text AS needs_review,
           count(*) FILTER (WHERE status = 'READY_FOR_PRODUCTION')::text AS ready_to_submit,
           count(*) FILTER (WHERE status = 'ON_HOLD')::text AS on_hold,
           count(*) FILTER (WHERE status IN ('FAILED','REPRINT_REQUIRED','REFUND_REQUIRED'))::text AS failed
         FROM app.orders`,
      ),
      this.listOrders(session, { page: 1, limit: 6 }),
      this.pool.query<{ product_name: string; units: string; orders: string }>(
        `SELECT model.display_name AS product_name, sum(item.quantity)::text AS units,
                count(DISTINCT item.order_id)::text AS orders
         FROM app.order_items item
         JOIN app.product_models model ON model.id = item.product_model_id
         JOIN app.orders orders ON orders.id = item.order_id
         WHERE orders.created_at >= now() - interval '30 days'
         GROUP BY model.id, model.display_name
         ORDER BY sum(item.quantity) DESC, model.display_name
         LIMIT 5`,
      ),
    ]);
    const metric = metrics.rows[0];
    const queue = attention.rows[0];
    const orderCount = Number(metric?.order_count ?? 0);
    const grossSalesCents = Number(metric?.gross_sales_cents ?? 0);
    return {
      metrics: {
        grossSalesCents,
        orders: orderCount,
        averageOrderValueCents: orderCount ? Math.round(grossSalesCents / orderCount) : 0,
        customers: Number(metric?.customer_count ?? 0),
        returningCustomers: Number(metric?.returning_customers ?? 0),
      },
      attention: {
        needsReview: Number(queue?.needs_review ?? 0),
        readyToSubmit: Number(queue?.ready_to_submit ?? 0),
        onHold: Number(queue?.on_hold ?? 0),
        failed: Number(queue?.failed ?? 0),
      },
      recentOrders: recentOrders.orders,
      bestSellers: bestSellers.rows.map((row) => ({
        productName: row.product_name,
        units: Number(row.units),
        orders: Number(row.orders),
      })),
    };
  }

  async listOrders(
    session: AdminStaffSession,
    options: AdminOrderListOptions = {},
  ): Promise<AdminOrderList> {
    assertStaffRead(session);
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 30)));
    const sort = options.sort ?? 'DATE_DESC';
    if (!adminOrderSorts.includes(sort))
      throw new AdminCommerceValidationError('Unsupported order sort.');
    const filter = buildAdminOrderFilter(options);
    const values = [...filter.values];
    const clause = filter.predicates.length ? `WHERE ${filter.predicates.join(' AND ')}` : '';
    const count = await this.pool.query<{ count: string }>(
      `SELECT count(DISTINCT orders.id)::text AS count FROM app.orders orders
       LEFT JOIN app.payments payment ON payment.checkout_attempt_id = orders.checkout_attempt_id
       LEFT JOIN LATERAL (${adminOrderLayerSql()}) layers ON true ${clause}`,
      [...values],
    );
    values.push(limit, (page - 1) * limit);
    const rows = await this.pool.query<{
      id: string;
      order_number: string;
      status: string;
      customer_email: string;
      customer_name: string | null;
      product_name: string;
      item_count: number;
      total_cents: number;
      payment_status: string | null;
      printing_status: string;
      fulfillment_status: string;
      currency: string;
      created_at: Date;
    }>(
      `SELECT orders.id, orders.order_number, orders.status, orders.customer_email,
              orders.shipping_address_snapshot->>'recipientName' AS customer_name,
              min(model.display_name) AS product_name,
              coalesce(sum(item.quantity), 0)::int AS item_count,
              coalesce((orders.pricing_snapshot->>'totalCents')::int, 0) AS total_cents,
              payment.status AS payment_status, layers.printing_status,
              layers.fulfillment_status,
              coalesce(orders.pricing_snapshot->>'currency', 'USD') AS currency,
              orders.created_at
       FROM app.orders orders
       LEFT JOIN app.order_items item ON item.order_id = orders.id
       LEFT JOIN app.product_models model ON model.id = item.product_model_id
       LEFT JOIN app.payments payment ON payment.checkout_attempt_id = orders.checkout_attempt_id
       LEFT JOIN LATERAL (${adminOrderLayerSql()}) layers ON true
       ${clause}
       GROUP BY orders.id, payment.status, layers.printing_status, layers.fulfillment_status
       ORDER BY ${adminOrderSortSql(sort)}
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      orders: rows.rows.map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        status: row.status,
        customerEmail: row.customer_email,
        customerName: row.customer_name?.trim() || row.customer_email,
        productName: row.product_name || 'Custom product',
        itemCount: row.item_count,
        totalCents: row.total_cents,
        paymentStatus: row.payment_status ?? 'UNKNOWN',
        printingStatus: row.printing_status,
        fulfillmentStatus: row.fulfillment_status,
        currency: row.currency,
        createdAt: row.created_at,
      })),
      total: Number(count.rows[0]?.count ?? 0),
      page,
      limit,
    };
  }

  async getOrder(
    session: AdminStaffSession,
    orderNumber: string,
  ): Promise<AdminOrderCommerceDetail | null> {
    assertStaffRead(session);
    const result = await this.pool.query<{
      id: string;
      order_number: string;
      status: string;
      customer_email: string;
      customer_name: string | null;
      total_cents: number;
      currency: string;
      payment_status: string | null;
      printing_status: string;
      fulfillment_status: string;
      shipping_address_snapshot: Record<string, unknown>;
      billing_address_snapshot: Record<string, unknown>;
      created_at: Date;
      items: Array<{
        productName: string;
        color: string | null;
        size: string | null;
        quantity: number;
      }>;
    }>(
      `SELECT orders.id, orders.order_number, orders.status, orders.customer_email,
              orders.shipping_address_snapshot->>'recipientName' AS customer_name,
              coalesce((orders.pricing_snapshot->>'totalCents')::int, 0) AS total_cents,
              coalesce(orders.pricing_snapshot->>'currency', 'USD') AS currency,
              payment.status AS payment_status, orders.shipping_address_snapshot,
              orders.billing_address_snapshot, orders.created_at,
              admin_order_layers.printing_status,
              admin_order_layers.fulfillment_status,
              coalesce(jsonb_agg(jsonb_build_object(
                'productName', model.display_name,
                'color', item.item_snapshot->>'colorCode',
                'size', item.item_snapshot->>'sizeCode',
                'quantity', item.quantity
              ) ORDER BY item.created_at) FILTER (WHERE item.id IS NOT NULL), '[]'::jsonb) AS items
       FROM app.orders orders
       LEFT JOIN app.order_items item ON item.order_id = orders.id
       LEFT JOIN app.product_models model ON model.id = item.product_model_id
       LEFT JOIN app.payments payment ON payment.checkout_attempt_id = orders.checkout_attempt_id
       LEFT JOIN LATERAL (${adminOrderLayerSql()}) admin_order_layers ON true
       WHERE orders.order_number = $1
       GROUP BY orders.id, payment.status, admin_order_layers.printing_status,
                admin_order_layers.fulfillment_status`,
      [orderNumber],
    );
    const row = result.rows[0];
    if (!row) return null;
    const itemCount = row.items.reduce((sum, item) => sum + item.quantity, 0);
    return {
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      customerEmail: row.customer_email,
      customerName: row.customer_name?.trim() || row.customer_email,
      productName: row.items[0]?.productName ?? 'Custom product',
      itemCount,
      totalCents: row.total_cents,
      paymentStatus: row.payment_status ?? 'UNKNOWN',
      printingStatus: row.printing_status,
      fulfillmentStatus: row.fulfillment_status,
      currency: row.currency,
      createdAt: row.created_at,
      shippingAddress: row.shipping_address_snapshot,
      billingAddress: row.billing_address_snapshot,
      items: row.items.map((item) => ({
        productName: item.productName,
        color: item.color ?? '—',
        size: item.size ?? '—',
        quantity: item.quantity,
      })),
    };
  }
}

function assertStaffRead(session: AdminStaffSession) {
  if (!session.staffMemberId) throw new Error('Admin access is restricted.');
}

function validateDate(value: string | undefined, label: 'start' | 'end') {
  if (value === undefined) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new AdminCommerceValidationError(`Enter a valid ${label} date.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new AdminCommerceValidationError(`Enter a valid ${label} date.`);
}

function validateTotal(value: number | undefined, label: 'minimum' | 'maximum') {
  if (value !== undefined && (!Number.isInteger(value) || value < 0))
    throw new AdminCommerceValidationError(`Enter a valid ${label} total.`);
}

export function buildAdminOrderFilter(options: AdminOrderListOptions): AdminOrderFilterQuery {
  const view = options.view ?? 'ALL';
  if (!adminOrderViews.includes(view))
    throw new AdminCommerceValidationError('Unsupported order view.');
  if (options.paymentStatus && !adminPaymentStatuses.includes(options.paymentStatus))
    throw new AdminCommerceValidationError('Unsupported payment status.');
  if (options.printingStatus && !adminPrintingStatuses.includes(options.printingStatus))
    throw new AdminCommerceValidationError('Unsupported printing status.');
  if (options.fulfillmentStatus && !adminFulfillmentStatuses.includes(options.fulfillmentStatus))
    throw new AdminCommerceValidationError('Unsupported fulfillment status.');
  validateDate(options.dateFrom, 'start');
  validateDate(options.dateTo, 'end');
  validateTotal(options.minTotalCents, 'minimum');
  validateTotal(options.maxTotalCents, 'maximum');
  if (
    options.minTotalCents !== undefined &&
    options.maxTotalCents !== undefined &&
    options.minTotalCents > options.maxTotalCents
  )
    throw new AdminCommerceValidationError('Minimum total cannot exceed maximum total.');

  const values: unknown[] = [];
  const predicates: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (options.customerId) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        options.customerId,
      )
    )
      throw new AdminCommerceValidationError('Enter a valid customer id.');
    predicates.push(`orders.customer_profile_id = ${add(options.customerId)}::uuid`);
  }
  if (options.query?.trim()) {
    const query = add(`%${options.query.trim()}%`);
    predicates.push(
      `(orders.order_number ILIKE ${query}
        OR orders.customer_email ILIKE ${query}
        OR orders.shipping_address_snapshot->>'recipientName' ILIKE ${query}
        OR EXISTS (
          SELECT 1 FROM app.order_items search_item
          JOIN app.product_models search_model ON search_model.id=search_item.product_model_id
          WHERE search_item.order_id=orders.id AND search_model.display_name ILIKE ${query}
        ))`,
    );
  }
  const viewStates: Partial<Record<(typeof adminOrderViews)[number], string[]>> = {
    OPEN: ['PAID', 'PREPRESS_REVIEW', 'COMPLIANCE_REVIEW', 'ROUTING', 'READY_FOR_PRODUCTION'],
    IN_PROGRESS: ['SUBMITTED_TO_PRINTIFY', 'IN_PRODUCTION', 'PARTIALLY_SHIPPED'],
    COMPLETED: ['SHIPPED', 'DELIVERED'],
    ATTENTION: ['ON_HOLD', 'FAILED', 'REPRINT_REQUIRED', 'REFUND_REQUIRED'],
    CANCELLED: ['CANCELLED'],
  };
  const states = viewStates[view];
  if (states) predicates.push(`orders.status = ANY(${add(states)}::text[])`);
  if (options.paymentStatus) predicates.push(`payment.status = ${add(options.paymentStatus)}`);
  if (options.printingStatus)
    predicates.push(`layers.printing_status = ${add(options.printingStatus)}`);
  if (options.fulfillmentStatus)
    predicates.push(`layers.fulfillment_status = ${add(options.fulfillmentStatus)}`);
  if (options.dateFrom)
    predicates.push(
      `orders.created_at >= ${add(`${options.dateFrom}T00:00:00.000Z`)}::timestamptz`,
    );
  if (options.dateTo)
    predicates.push(
      `orders.created_at < (${add(`${options.dateTo}T00:00:00.000Z`)}::timestamptz + interval '1 day')`,
    );
  if (options.minTotalCents !== undefined)
    predicates.push(
      `coalesce((orders.pricing_snapshot->>'totalCents')::int, 0) >= ${add(options.minTotalCents)}`,
    );
  if (options.maxTotalCents !== undefined)
    predicates.push(
      `coalesce((orders.pricing_snapshot->>'totalCents')::int, 0) <= ${add(options.maxTotalCents)}`,
    );
  return { values, predicates };
}

function adminOrderSortSql(sort: AdminOrderSort) {
  const tieBreak = ',orders.id ASC';
  if (sort === 'ORDER_NUMBER_ASC')
    return `(regexp_replace(orders.order_number, '[^0-9]', '', 'g'))::bigint ASC${tieBreak}`;
  if (sort === 'ORDER_NUMBER_DESC')
    return `(regexp_replace(orders.order_number, '[^0-9]', '', 'g'))::bigint DESC${tieBreak}`;
  if (sort === 'DATE_ASC') return `orders.created_at ASC${tieBreak}`;
  if (sort === 'CUSTOMER_ASC')
    return `lower(coalesce(nullif(orders.shipping_address_snapshot->>'recipientName', ''), orders.customer_email)) ASC${tieBreak}`;
  if (sort === 'CUSTOMER_DESC')
    return `lower(coalesce(nullif(orders.shipping_address_snapshot->>'recipientName', ''), orders.customer_email)) DESC${tieBreak}`;
  if (sort === 'ITEMS_ASC') return `item_count ASC${tieBreak}`;
  if (sort === 'ITEMS_DESC') return `item_count DESC${tieBreak}`;
  if (sort === 'PAYMENT_ASC') return `payment.status ASC NULLS LAST${tieBreak}`;
  if (sort === 'PAYMENT_DESC') return `payment.status DESC NULLS LAST${tieBreak}`;
  if (sort === 'FULFILLMENT_ASC') return `layers.fulfillment_status ASC${tieBreak}`;
  if (sort === 'FULFILLMENT_DESC') return `layers.fulfillment_status DESC${tieBreak}`;
  if (sort === 'TOTAL_ASC') return `total_cents ASC${tieBreak}`;
  if (sort === 'TOTAL_DESC') return `total_cents DESC${tieBreak}`;
  return `orders.created_at DESC${tieBreak}`;
}

export function adminOrderLayerSql() {
  return `SELECT
    CASE
      WHEN count(group_row.id) = 0 THEN 'NOT_STARTED'
      WHEN bool_and(group_row.printing_status = 'CANCELLED') THEN 'CANCELLED'
      WHEN bool_or(group_row.printing_status IN ('FAILED','ON_HOLD')) THEN 'NEEDS_ATTENTION'
      WHEN count(DISTINCT group_row.printing_status) = 1 THEN min(group_row.printing_status)
      WHEN bool_or(group_row.printing_status = 'PRINTED') THEN 'PARTIALLY_PRINTED'
      WHEN bool_or(group_row.printing_status IN ('IN_PRODUCTION','SUBMITTED')) THEN 'PARTIALLY_IN_PRODUCTION'
      WHEN bool_or(group_row.printing_status = 'SUBMITTING') THEN 'SUBMITTING'
      WHEN bool_or(group_row.printing_status = 'READY_FOR_PRODUCTION') THEN 'READY_FOR_PRODUCTION'
      WHEN bool_or(group_row.printing_status = 'COMPLIANCE_REVIEW') THEN 'COMPLIANCE_REVIEW'
      WHEN bool_or(group_row.printing_status = 'PREPRESS_REVIEW') THEN 'PREPRESS_REVIEW'
      ELSE 'NOT_STARTED'
    END AS printing_status,
    CASE
      WHEN count(group_row.id) = 0 THEN 'UNFULFILLED'
      WHEN bool_and(group_row.fulfillment_status = 'CANCELLED') THEN 'CANCELLED'
      WHEN bool_and(group_row.fulfillment_status = 'DELIVERED') THEN 'DELIVERED'
      WHEN bool_and(group_row.fulfillment_status IN ('FULFILLED','DELIVERED')) THEN 'FULFILLED'
      WHEN bool_or(group_row.fulfillment_status IN ('PARTIALLY_FULFILLED','FULFILLED','DELIVERED')) THEN 'PARTIALLY_FULFILLED'
      ELSE 'UNFULFILLED'
    END AS fulfillment_status
    FROM app.order_fulfillment_groups group_row WHERE group_row.order_id = orders.id`;
}
