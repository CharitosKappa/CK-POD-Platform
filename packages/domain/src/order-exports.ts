import { TextEncoder } from 'node:util';

import type { SqlPool } from '@let-it-be/db';
import type { BackgroundJobQueue, QueueWorker } from '@let-it-be/queue';
import type { OpenedPrivateObject, PrivateObjectStorage } from '@let-it-be/storage';

import {
  adminOrderLayerSql,
  buildAdminOrderFilter,
  type AdminStaffSession,
} from './admin-commerce';
import {
  adminFulfillmentStatuses,
  adminOrderViews,
  adminPaymentStatuses,
  adminPrintingStatuses,
  type AdminFulfillmentStatus,
  type AdminOrderView,
  type AdminPaymentStatus,
  type AdminPrintingStatus,
} from './admin-order-contracts';

export const synchronousOrderExportLimit = 1_000;
export const orderExportQueueName = 'order-exports';
export const orderExportJobName = 'build-order-export';
const batchSize = 500;
const retentionMs = 7 * 24 * 60 * 60_000;
const maxIds = 10_000;

export type OrderExportFilters = Readonly<{
  query?: string;
  view?: AdminOrderView;
  customerId?: string;
  paymentStatus?: AdminPaymentStatus;
  printingStatus?: AdminPrintingStatus;
  fulfillmentStatus?: AdminFulfillmentStatus;
  dateFrom?: string;
  dateTo?: string;
  minTotalCents?: number;
  maxTotalCents?: number;
}>;
export type OrderExportSelection =
  | Readonly<{ type: 'IDS'; orderIds: string[] }>
  | Readonly<{ type: 'FILTER'; filters: OrderExportFilters; excludedOrderIds?: string[] }>;
export type OrderExportStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';
export type OrderExportSummary = Readonly<{
  id: string;
  status: OrderExportStatus;
  totalCount: number;
  processedCount: number;
  fileName: string;
  failureReason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}>;
export type OrderExportRequestResult =
  | Readonly<{ mode: 'IMMEDIATE'; fileName: string; totalCount: number; body: Uint8Array }>
  | Readonly<{ mode: 'QUEUED'; export: OrderExportSummary }>;

export class OrderExportAccessError extends Error {}
export class OrderExportValidationError extends Error {}

export class OrderExportService {
  constructor(
    private readonly pool: SqlPool,
    private readonly queue: BackgroundJobQueue,
    private readonly storage: PrivateObjectStorage,
  ) {}

  async request(
    session: AdminStaffSession,
    input: OrderExportSelection,
  ): Promise<OrderExportRequestResult> {
    const actor = requireStaff(session);
    const selection = normalizeSelection(input);
    const totalCount = await this.count(selection);
    if (!totalCount) throw new OrderExportValidationError('Choose at least one order.');
    const fileName = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    if (totalCount <= synchronousOrderExportLimit) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.csvChunks(selection)) chunks.push(chunk);
      await this.audit(actor.staffMemberId, 'ORDERS_EXPORTED', {
        count: totalCount,
        mode: 'IMMEDIATE',
      });
      return { mode: 'IMMEDIATE', fileName, totalCount, body: concatenate(chunks) };
    }
    const created = await this.pool.query<OrderExportRow>(
      `INSERT INTO app.order_exports
       (requested_by_staff_member_id,status,selection_snapshot,total_count,file_name)
       VALUES ($1,'QUEUED',$2::jsonb,$3,$4) RETURNING *`,
      [actor.staffMemberId, JSON.stringify(selection), totalCount, fileName],
    );
    const row = requireRow(created.rows[0]);
    try {
      const job = await this.queue.enqueue({
        queue: orderExportQueueName,
        name: orderExportJobName,
        payload: { exportId: row.id },
        options: { attempts: 3, idempotencyKey: row.id },
      });
      await this.pool.query(
        `UPDATE app.order_exports SET queue_job_id=$2,updated_at=now() WHERE id=$1`,
        [row.id, job.id],
      );
    } catch (error) {
      await this.pool.query(
        `UPDATE app.order_exports SET status='FAILED',failure_reason=$2,updated_at=now() WHERE id=$1`,
        [row.id, safeFailure(error)],
      );
      throw error;
    }
    await this.audit(actor.staffMemberId, 'ORDER_EXPORT_REQUESTED', {
      exportId: row.id,
      count: totalCount,
      mode: 'BACKGROUND',
    });
    return { mode: 'QUEUED', export: summary(row) };
  }

  async list(session: AdminStaffSession, limit = 8) {
    const actor = requireStaff(session);
    const result = await this.pool.query<OrderExportRow>(
      `SELECT * FROM app.order_exports WHERE requested_by_staff_member_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [actor.staffMemberId, Math.max(1, Math.min(25, Math.trunc(limit)))],
    );
    return result.rows.map(summary);
  }

  async download(
    session: AdminStaffSession,
    exportId: string,
  ): Promise<{ export: OrderExportSummary; object: OpenedPrivateObject }> {
    const actor = requireStaff(session);
    const result = await this.pool.query<OrderExportRow>(
      `SELECT * FROM app.order_exports WHERE id=$1`,
      [uuid(exportId)],
    );
    const row = requireRow(result.rows[0]);
    if (row.requested_by_staff_member_id !== actor.staffMemberId && actor.role !== 'OWNER')
      throw new OrderExportAccessError('Order export access is restricted.');
    if (row.status !== 'READY' || !row.storage_key)
      throw new OrderExportValidationError('This export is not ready for download.');
    if (!row.expires_at || row.expires_at <= new Date()) {
      await this.expire(row);
      throw new OrderExportValidationError('This export has expired.');
    }
    const object = await this.storage.open(row.storage_key);
    if (!object) throw new OrderExportValidationError('The export file is unavailable.');
    return { export: summary(row), object };
  }

  async process(exportId: string) {
    const claimed = await this.pool.query<OrderExportRow>(
      `UPDATE app.order_exports SET status='PROCESSING',started_at=coalesce(started_at,now()),failure_reason=NULL,updated_at=now() WHERE id=$1 AND status IN ('QUEUED','FAILED') RETURNING *`,
      [uuid(exportId)],
    );
    const row = claimed.rows[0];
    if (!row) return;
    const key = `admin/order-exports/${row.id}.csv`;
    try {
      await this.storage.put({
        key,
        body: this.csvChunks(normalizeSelection(row.selection_snapshot), row.id),
        contentType: 'text/csv; charset=utf-8',
        metadata: { exportId: row.id, recordCount: String(row.total_count) },
      });
      await this.pool.query(
        `UPDATE app.order_exports SET status='READY',processed_count=total_count,storage_key=$2,completed_at=now(),expires_at=$3,updated_at=now() WHERE id=$1 AND status='PROCESSING'`,
        [row.id, key, new Date(Date.now() + retentionMs)],
      );
    } catch (error) {
      await this.pool.query(
        `UPDATE app.order_exports SET status='FAILED',failure_reason=$2,updated_at=now() WHERE id=$1 AND status='PROCESSING'`,
        [row.id, safeFailure(error)],
      );
      throw error;
    }
  }

  async recoverPending(staleAfterMs = 15 * 60_000) {
    const recovered = await this.pool.query<{ id: string }>(
      `UPDATE app.order_exports SET status='QUEUED',failure_reason='Recovered after interrupted processing',updated_at=now() WHERE status='PROCESSING' AND updated_at < $1 RETURNING id`,
      [new Date(Date.now() - staleAfterMs)],
    );
    const queued = await this.pool.query<{ id: string }>(
      `SELECT id FROM app.order_exports WHERE status='QUEUED' ORDER BY created_at LIMIT 100`,
    );
    return [...new Set([...recovered.rows, ...queued.rows].map((row) => row.id))];
  }
  async expireReady(now = new Date()) {
    const result = await this.pool.query<OrderExportRow>(
      `SELECT * FROM app.order_exports WHERE status='READY' AND expires_at <= $1 ORDER BY expires_at LIMIT 100`,
      [now],
    );
    for (const row of result.rows) await this.expire(row);
    return result.rows.length;
  }
  private async expire(row: OrderExportRow) {
    if (row.storage_key) await this.storage.delete(row.storage_key);
    await this.pool.query(
      `UPDATE app.order_exports SET status='EXPIRED',storage_key=NULL,updated_at=now() WHERE id=$1 AND status='READY'`,
      [row.id],
    );
  }
  private async count(selection: OrderExportSelection) {
    const query = selectionQuery(selection);
    const result = await this.pool.query<{ count: number }>(
      `SELECT count(DISTINCT orders.id)::int AS count
       FROM app.orders orders
       LEFT JOIN app.payments payment ON payment.checkout_attempt_id=orders.checkout_attempt_id
       LEFT JOIN LATERAL (${adminOrderLayerSql()}) layers ON true
       ${query.whereSql}`,
      query.values,
    );
    return result.rows[0]?.count ?? 0;
  }
  private async *csvChunks(
    selection: OrderExportSelection,
    exportId?: string,
  ): AsyncIterable<Uint8Array> {
    const encoder = new TextEncoder();
    yield encoder.encode(`\uFEFF${header().join(',')}\r\n`);
    let cursor: string | undefined;
    let processed = 0;
    while (true) {
      const query = selectionQuery(selection, cursor);
      query.values.push(batchSize);
      const result = await this.pool.query<OrderExportDataRow>(
        `SELECT orders.id,orders.order_number,orders.created_at,coalesce(nullif(orders.shipping_address_snapshot->>'recipientName',''),orders.customer_email) AS customer_name,orders.customer_email,coalesce(products.names,ARRAY[]::text[]) AS products,coalesce(products.item_count,0)::int AS item_count,payment.status AS payment_status,coalesce(layers.printing_status,'NOT_STARTED') AS printing_status,coalesce(layers.fulfillment_status,'UNFULFILLED') AS fulfillment_status,coalesce((orders.pricing_snapshot->>'totalCents')::int,0) AS total_cents,coalesce(orders.pricing_snapshot->>'currency','USD') AS currency,orders.shipping_address_snapshot->>'city' AS shipping_city,orders.shipping_address_snapshot->>'stateCode' AS shipping_state,orders.shipping_address_snapshot->>'countryCode' AS shipping_country FROM app.orders orders LEFT JOIN app.payments payment ON payment.checkout_attempt_id=orders.checkout_attempt_id LEFT JOIN LATERAL (SELECT array_agg(DISTINCT model.display_name ORDER BY model.display_name) AS names,sum(item.quantity)::int AS item_count FROM app.order_items item JOIN app.product_models model ON model.id=item.product_model_id WHERE item.order_id=orders.id) products ON true LEFT JOIN LATERAL (${adminOrderLayerSql()}) layers ON true ${query.whereSql} ORDER BY orders.id LIMIT $${query.values.length}`,
        query.values,
      );
      if (!result.rows.length) break;
      yield encoder.encode(`${result.rows.map(csvRow).join('\r\n')}\r\n`);
      processed += result.rows.length;
      cursor = result.rows.at(-1)!.id;
      if (exportId)
        await this.pool.query(
          `UPDATE app.order_exports SET processed_count=LEAST($2,total_count),updated_at=now() WHERE id=$1 AND status='PROCESSING'`,
          [exportId, processed],
        );
      if (result.rows.length < batchSize) break;
    }
  }
  private async audit(staffMemberId: string, eventType: string, metadata: object) {
    await this.pool.query(
      `INSERT INTO app.staff_audit_events (staff_member_id,event_type,metadata) VALUES ($1,$2,$3::jsonb)`,
      [staffMemberId, eventType, JSON.stringify(metadata)],
    );
  }
}

export function startOrderExportConsumer(
  queue: BackgroundJobQueue,
  process: (exportId: string) => Promise<void>,
): Promise<QueueWorker> {
  return queue.process<{ exportId: string }>(orderExportQueueName, async (job) =>
    process(job.payload.exportId),
  );
}

function selectionQuery(selection: OrderExportSelection, cursor?: string) {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (selection.type === 'IDS') where.push(`orders.id=ANY(${add(selection.orderIds)}::uuid[])`);
  else {
    const filter = buildAdminOrderFilter(selection.filters);
    values.push(...filter.values);
    where.push(...filter.predicates);
    if (selection.excludedOrderIds?.length)
      where.push(`NOT (orders.id=ANY(${add(selection.excludedOrderIds)}::uuid[]))`);
  }
  if (cursor) where.push(`orders.id>${add(cursor)}::uuid`);
  return { values, whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

function normalizeSelection(input: unknown): OrderExportSelection {
  if (!record(input)) throw new OrderExportValidationError('Choose orders to export.');
  if (input.type === 'IDS') {
    if (!Array.isArray(input.orderIds))
      throw new OrderExportValidationError('Choose orders to export.');
    return { type: 'IDS', orderIds: ids(input.orderIds, false) };
  }
  if (input.type !== 'FILTER' || !record(input.filters))
    throw new OrderExportValidationError('Choose orders to export.');
  const raw = input.filters;
  const view = String(raw.view ?? 'ALL');
  if (!adminOrderViews.includes(view as AdminOrderView))
    throw new OrderExportValidationError('Unsupported order view.');
  const paymentStatus = enumValue(
    raw.paymentStatus,
    adminPaymentStatuses,
    'Unsupported payment status.',
  );
  const printingStatus = enumValue(
    raw.printingStatus,
    adminPrintingStatuses,
    'Unsupported printing status.',
  );
  const fulfillmentStatus = enumValue(
    raw.fulfillmentStatus,
    adminFulfillmentStatuses,
    'Unsupported fulfillment status.',
  );
  const query = text(raw.query);
  const customerId = text(raw.customerId);
  const dateFrom = text(raw.dateFrom);
  const dateTo = text(raw.dateTo);
  const filters: OrderExportFilters = {
    view: view as AdminOrderView,
    ...(query ? { query } : {}),
    ...(customerId ? { customerId: uuid(customerId) } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(printingStatus ? { printingStatus } : {}),
    ...(fulfillmentStatus ? { fulfillmentStatus } : {}),
    ...(dateFrom ? { dateFrom: date(dateFrom, 'start') } : {}),
    ...(dateTo ? { dateTo: date(dateTo, 'end') } : {}),
    ...(raw.minTotalCents !== undefined
      ? { minTotalCents: cents(raw.minTotalCents, 'minimum') }
      : {}),
    ...(raw.maxTotalCents !== undefined
      ? { maxTotalCents: cents(raw.maxTotalCents, 'maximum') }
      : {}),
  };
  if (
    filters.minTotalCents !== undefined &&
    filters.maxTotalCents !== undefined &&
    filters.minTotalCents > filters.maxTotalCents
  )
    throw new OrderExportValidationError('Minimum total cannot exceed maximum total.');
  const excludedOrderIds = Array.isArray(input.excludedOrderIds)
    ? ids(input.excludedOrderIds, true)
    : [];
  return { type: 'FILTER', filters, ...(excludedOrderIds.length ? { excludedOrderIds } : {}) };
}
function ids(values: unknown[], allowEmpty: boolean) {
  const result = [...new Set(values.map(uuid))];
  if ((!allowEmpty && !result.length) || result.length > maxIds)
    throw new OrderExportValidationError(
      `Choose between ${allowEmpty ? 0 : 1} and ${maxIds.toLocaleString('en-US')} orders.`,
    );
  return result;
}
function uuid(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw new OrderExportValidationError('Invalid order selection.');
  return value;
}
function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, message: string) {
  if (value === undefined) return undefined;
  const normalized = String(value);
  if (!allowed.includes(normalized)) throw new OrderExportValidationError(message);
  return normalized as T[number];
}
function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function date(value: string | undefined, label: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new OrderExportValidationError(`Enter a valid ${label} date.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new OrderExportValidationError(`Enter a valid ${label} date.`);
  return value;
}
function cents(value: unknown, label: string) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0)
    throw new OrderExportValidationError(`Enter a valid ${label} total.`);
  return result;
}
function requireStaff(session: AdminStaffSession) {
  if (!session.staffMemberId || !['OWNER', 'OPERATIONS'].includes(session.role))
    throw new OrderExportAccessError('Order export access is restricted.');
  return session;
}
function header() {
  return [
    'Order ID',
    'Created at',
    'Customer name',
    'Customer email',
    'Products',
    'Item quantity',
    'Payment status',
    'Printing status',
    'Fulfillment status',
    'Total',
    'Currency',
    'Shipping city',
    'Shipping state',
    'Shipping country',
  ];
}
function csvRow(row: OrderExportDataRow) {
  return [
    row.order_number,
    row.created_at.toISOString(),
    row.customer_name,
    row.customer_email,
    row.products.join('; '),
    row.item_count,
    row.payment_status,
    row.printing_status,
    row.fulfillment_status,
    (row.total_cents / 100).toFixed(2),
    row.currency,
    row.shipping_city,
    row.shipping_state,
    row.shipping_country,
  ]
    .map(escapeCsv)
    .join(',');
}
function escapeCsv(value: unknown) {
  const valueText = value == null ? '' : String(value);
  return /[",\r\n]/.test(valueText) ? `"${valueText.replaceAll('"', '""')}"` : valueText;
}
function concatenate(chunks: Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function safeFailure(error: unknown) {
  return (error instanceof Error ? error.message : 'Order export failed.').slice(0, 500);
}
function requireRow(row: OrderExportRow | undefined) {
  if (!row) throw new OrderExportValidationError('Export not found.');
  return row;
}
function summary(row: OrderExportRow): OrderExportSummary {
  return {
    id: row.id,
    status: row.status,
    totalCount: row.total_count,
    processedCount: row.processed_count,
    fileName: row.file_name,
    failureReason: row.failure_reason,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

interface OrderExportRow {
  id: string;
  requested_by_staff_member_id: string | null;
  status: OrderExportStatus;
  selection_snapshot: unknown;
  total_count: number;
  processed_count: number;
  storage_key: string | null;
  file_name: string;
  failure_reason: string | null;
  queue_job_id: string | null;
  expires_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
interface OrderExportDataRow {
  id: string;
  order_number: string;
  created_at: Date;
  customer_name: string;
  customer_email: string;
  products: string[];
  item_count: number;
  payment_status: string;
  printing_status: string;
  fulfillment_status: string;
  total_cents: number;
  currency: string;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_country: string | null;
}
