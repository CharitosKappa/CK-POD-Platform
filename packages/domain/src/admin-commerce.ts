import type { SqlPool } from '@let-it-be/db';

import type { StaffSession } from './staff-identity';

export type AdminStaffSession = Omit<StaffSession, 'token'>;

export interface AdminOrderSummary {
  orderNumber: string;
  status: string;
  customerEmail: string;
  customerName: string;
  productName: string;
  itemCount: number;
  totalCents: number;
  paymentStatus: string;
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
    options: { page?: number; limit?: number; query?: string; view?: string } = {},
  ): Promise<AdminOrderList> {
    assertStaffRead(session);
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 30)));
    const values: unknown[] = [];
    const where: string[] = [];
    if (options.query?.trim()) {
      values.push(`%${options.query.trim()}%`);
      where.push(
        `(orders.order_number ILIKE $${values.length} OR orders.customer_email ILIKE $${values.length} OR orders.shipping_address_snapshot->>'recipientName' ILIKE $${values.length})`,
      );
    }
    const viewStates: Record<string, string[]> = {
      OPEN: ['PAID', 'PREPRESS_REVIEW', 'COMPLIANCE_REVIEW', 'ROUTING', 'READY_FOR_PRODUCTION'],
      UNFULFILLED: [
        'PAID',
        'PREPRESS_REVIEW',
        'COMPLIANCE_REVIEW',
        'ROUTING',
        'READY_FOR_PRODUCTION',
      ],
      IN_PROGRESS: ['SUBMITTED_TO_PRINTIFY', 'IN_PRODUCTION', 'PARTIALLY_SHIPPED'],
      COMPLETED: ['SHIPPED', 'DELIVERED'],
      ATTENTION: ['ON_HOLD', 'FAILED', 'REPRINT_REQUIRED', 'REFUND_REQUIRED'],
      CANCELLED: ['CANCELLED'],
    };
    const states = options.view ? viewStates[options.view] : undefined;
    if (states) {
      values.push(states);
      where.push(`orders.status = ANY($${values.length}::text[])`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.orders orders ${clause}`,
      values,
    );
    values.push(limit, (page - 1) * limit);
    const rows = await this.pool.query<{
      order_number: string;
      status: string;
      customer_email: string;
      customer_name: string | null;
      product_name: string;
      item_count: number;
      total_cents: number;
      payment_status: string | null;
      created_at: Date;
    }>(
      `SELECT orders.order_number, orders.status, orders.customer_email,
              orders.shipping_address_snapshot->>'recipientName' AS customer_name,
              min(model.display_name) AS product_name,
              coalesce(sum(item.quantity), 0)::int AS item_count,
              coalesce((orders.pricing_snapshot->>'totalCents')::int, 0) AS total_cents,
              payment.status AS payment_status, orders.created_at
       FROM app.orders orders
       LEFT JOIN app.order_items item ON item.order_id = orders.id
       LEFT JOIN app.product_models model ON model.id = item.product_model_id
       LEFT JOIN app.payments payment ON payment.checkout_attempt_id = orders.checkout_attempt_id
       ${clause}
       GROUP BY orders.id, payment.status
       ORDER BY orders.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      orders: rows.rows.map((row) => ({
        orderNumber: row.order_number,
        status: row.status,
        customerEmail: row.customer_email,
        customerName: row.customer_name?.trim() || row.customer_email,
        productName: row.product_name || 'Custom product',
        itemCount: row.item_count,
        totalCents: row.total_cents,
        paymentStatus: row.payment_status ?? 'UNKNOWN',
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
      order_number: string;
      status: string;
      customer_email: string;
      customer_name: string | null;
      total_cents: number;
      payment_status: string | null;
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
      `SELECT orders.order_number, orders.status, orders.customer_email,
              orders.shipping_address_snapshot->>'recipientName' AS customer_name,
              coalesce((orders.pricing_snapshot->>'totalCents')::int, 0) AS total_cents,
              payment.status AS payment_status, orders.shipping_address_snapshot,
              orders.billing_address_snapshot, orders.created_at,
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
       WHERE orders.order_number = $1
       GROUP BY orders.id, payment.status`,
      [orderNumber],
    );
    const row = result.rows[0];
    if (!row) return null;
    const itemCount = row.items.reduce((sum, item) => sum + item.quantity, 0);
    return {
      orderNumber: row.order_number,
      status: row.status,
      customerEmail: row.customer_email,
      customerName: row.customer_name?.trim() || row.customer_email,
      productName: row.items[0]?.productName ?? 'Custom product',
      itemCount,
      totalCents: row.total_cents,
      paymentStatus: row.payment_status ?? 'UNKNOWN',
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
