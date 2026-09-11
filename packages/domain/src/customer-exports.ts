import { TextEncoder } from 'node:util';

import type { SqlPool } from '@let-it-be/db';
import type { BackgroundJobQueue, QueueWorker } from '@let-it-be/queue';
import type { OpenedPrivateObject, PrivateObjectStorage } from '@let-it-be/storage';

import {
  CUSTOMER_HIGH_VALUE_CENTS,
  CUSTOMER_NEW_DAYS,
  customerViews,
  escapeCustomerCsv,
  marketingStatuses,
  type CustomerView,
  type MarketingStatus,
} from './customer-contracts';
import type { CustomerOperationsActor } from './customer-operations';

export const customerExportQueueName = 'customer-exports';
export const customerExportJobName = 'build-customer-export';
export const synchronousCustomerExportLimit = 1_000;

const exportBatchSize = 500;
const exportRetentionMs = 7 * 24 * 60 * 60_000;
const maximumExplicitSelection = 10_000;

export type CustomerExportFilters = Readonly<{
  query?: string;
  view?: CustomerView;
  location?: string;
  emailMarketingStatus?: MarketingStatus;
  minOrders?: number;
}>;

export type CustomerExportSelection =
  | Readonly<{ type: 'IDS'; customerIds: string[] }>
  | Readonly<{
      type: 'FILTER';
      filters: CustomerExportFilters;
      excludedCustomerIds?: string[];
    }>;

export type CustomerExportStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';

export type CustomerExportSummary = Readonly<{
  id: string;
  status: CustomerExportStatus;
  totalCount: number;
  processedCount: number;
  fileName: string;
  failureReason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}>;

export type CustomerExportRequestResult =
  | Readonly<{ mode: 'IMMEDIATE'; fileName: string; totalCount: number; body: Uint8Array }>
  | Readonly<{ mode: 'QUEUED'; export: CustomerExportSummary }>;

type ExportJobPayload = Readonly<{ exportId: string }>;

export class CustomerExportAccessError extends Error {}
export class CustomerExportValidationError extends Error {}

export class CustomerExportService {
  public constructor(
    private readonly pool: SqlPool,
    private readonly queue: BackgroundJobQueue,
    private readonly storage: PrivateObjectStorage,
  ) {}

  async request(
    session: CustomerOperationsActor,
    input: CustomerExportSelection,
  ): Promise<CustomerExportRequestResult> {
    const actor = requireExportStaff(session);
    const selection = normalizeSelection(input);
    const totalCount = await this.count(selection);
    if (!totalCount) throw new CustomerExportValidationError('Choose at least one customer.');
    const fileName = exportFileName();

    if (totalCount <= synchronousCustomerExportLimit) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.csvChunks(selection)) chunks.push(chunk);
      const body = concatenate(chunks);
      await this.audit(actor.staffMemberId, 'CUSTOMERS_EXPORTED', {
        count: totalCount,
        mode: 'IMMEDIATE',
      });
      return { mode: 'IMMEDIATE', fileName, totalCount, body };
    }

    const created = await this.pool.query<CustomerExportRow>(
      `INSERT INTO app.customer_exports
       (requested_by_staff_member_id,status,selection_snapshot,total_count,file_name)
       VALUES ($1,'QUEUED',$2::jsonb,$3,$4)
       RETURNING *`,
      [actor.staffMemberId, JSON.stringify(selection), totalCount, fileName],
    );
    const row = requireExportRow(created.rows[0]);
    try {
      const job = await this.queue.enqueue<ExportJobPayload>({
        queue: customerExportQueueName,
        name: customerExportJobName,
        payload: { exportId: row.id },
        options: { attempts: 3, idempotencyKey: row.id },
      });
      await this.pool.query(
        `UPDATE app.customer_exports SET queue_job_id=$2,updated_at=now() WHERE id=$1`,
        [row.id, job.id],
      );
    } catch (error) {
      await this.pool.query(
        `UPDATE app.customer_exports
         SET status='FAILED',failure_reason=$2,updated_at=now() WHERE id=$1`,
        [row.id, safeFailure(error)],
      );
      throw error;
    }
    await this.audit(actor.staffMemberId, 'CUSTOMER_EXPORT_REQUESTED', {
      exportId: row.id,
      count: totalCount,
      mode: 'BACKGROUND',
    });
    return { mode: 'QUEUED', export: mapSummary(row) };
  }

  async list(session: CustomerOperationsActor, limit = 8): Promise<CustomerExportSummary[]> {
    const actor = requireExportStaff(session);
    const boundedLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
    const result = await this.pool.query<CustomerExportRow>(
      `SELECT * FROM app.customer_exports
       WHERE requested_by_staff_member_id=$1
       ORDER BY created_at DESC LIMIT $2`,
      [actor.staffMemberId, boundedLimit],
    );
    return result.rows.map(mapSummary);
  }

  async resolveIds(
    session: CustomerOperationsActor,
    input: CustomerExportSelection,
    maximum = maximumExplicitSelection,
  ): Promise<string[]> {
    requireExportStaff(session);
    const selection = normalizeSelection(input);
    const query = selectionQuery(selection);
    query.values.push(maximum + 1);
    const result = await this.pool.query<{ id: string }>(
      `SELECT cp.id ${exportFromSql()} ${query.whereSql}
       ORDER BY cp.id LIMIT $${query.values.length}`,
      query.values,
    );
    if (result.rows.length > maximum)
      throw new CustomerExportValidationError(
        `Choose up to ${maximum.toLocaleString('en-US')} customers for this bulk action.`,
      );
    if (!result.rows.length)
      throw new CustomerExportValidationError('Choose at least one customer.');
    return result.rows.map((row) => row.id);
  }

  async download(
    session: CustomerOperationsActor,
    exportId: string,
  ): Promise<{ export: CustomerExportSummary; object: OpenedPrivateObject }> {
    const actor = requireExportStaff(session);
    const result = await this.pool.query<CustomerExportRow>(
      `SELECT * FROM app.customer_exports WHERE id=$1`,
      [requireUuid(exportId, 'Export not found.')],
    );
    const row = requireExportRow(result.rows[0]);
    if (row.requested_by_staff_member_id !== actor.staffMemberId && actor.role !== 'OWNER')
      throw new CustomerExportAccessError('Export access is restricted.');
    if (row.status !== 'READY' || !row.storage_key)
      throw new CustomerExportValidationError('This export is not ready for download.');
    if (!row.expires_at || row.expires_at <= new Date()) {
      await this.expire(row);
      throw new CustomerExportValidationError('This export has expired.');
    }
    const object = await this.storage.open(row.storage_key);
    if (!object) throw new CustomerExportValidationError('The export file is unavailable.');
    await this.audit(actor.staffMemberId, 'CUSTOMER_EXPORT_DOWNLOADED', {
      exportId: row.id,
      count: row.total_count,
    });
    return { export: mapSummary(row), object };
  }

  async process(exportId: string): Promise<void> {
    const claimed = await this.pool.query<CustomerExportRow>(
      `UPDATE app.customer_exports
       SET status='PROCESSING',started_at=coalesce(started_at,now()),failure_reason=NULL,updated_at=now()
       WHERE id=$1 AND status IN ('QUEUED','FAILED')
       RETURNING *`,
      [requireUuid(exportId, 'Export not found.')],
    );
    const row = claimed.rows[0];
    if (!row) return;
    const key = `admin/customer-exports/${row.id}.csv`;
    try {
      const selection = normalizeSelection(row.selection_snapshot);
      await this.storage.put({
        key,
        body: this.csvChunks(selection, row.id),
        contentType: 'text/csv; charset=utf-8',
        metadata: { exportId: row.id, recordCount: String(row.total_count) },
      });
      await this.pool.query(
        `UPDATE app.customer_exports
         SET status='READY',processed_count=total_count,storage_key=$2,
             completed_at=now(),expires_at=$3,updated_at=now()
         WHERE id=$1 AND status='PROCESSING'`,
        [row.id, key, new Date(Date.now() + exportRetentionMs)],
      );
    } catch (error) {
      await this.pool.query(
        `UPDATE app.customer_exports
         SET status='FAILED',failure_reason=$2,updated_at=now()
         WHERE id=$1 AND status='PROCESSING'`,
        [row.id, safeFailure(error)],
      );
      throw error;
    }
  }

  async recoverPending(staleAfterMs = 15 * 60_000): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE app.customer_exports
       SET status='QUEUED',failure_reason='Recovered after interrupted processing',updated_at=now()
       WHERE status='PROCESSING' AND updated_at < $1
       RETURNING id`,
      [new Date(Date.now() - staleAfterMs)],
    );
    const queued = await this.pool.query<{ id: string }>(
      `SELECT id FROM app.customer_exports WHERE status='QUEUED' ORDER BY created_at LIMIT 100`,
    );
    return [...new Set([...result.rows, ...queued.rows].map((item) => item.id))];
  }

  async expireReady(now = new Date()): Promise<number> {
    const result = await this.pool.query<CustomerExportRow>(
      `SELECT * FROM app.customer_exports
       WHERE status='READY' AND expires_at <= $1 ORDER BY expires_at LIMIT 100`,
      [now],
    );
    for (const row of result.rows) await this.expire(row);
    return result.rows.length;
  }

  private async expire(row: CustomerExportRow): Promise<void> {
    if (row.storage_key) await this.storage.delete(row.storage_key);
    await this.pool.query(
      `UPDATE app.customer_exports
       SET status='EXPIRED',storage_key=NULL,updated_at=now() WHERE id=$1 AND status='READY'`,
      [row.id],
    );
  }

  private async count(selection: CustomerExportSelection): Promise<number> {
    const query = selectionQuery(selection);
    const result = await this.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count ${exportFromSql()} ${query.whereSql}`,
      query.values,
    );
    return result.rows[0]?.count ?? 0;
  }

  private async *csvChunks(
    selection: CustomerExportSelection,
    exportId?: string,
  ): AsyncIterable<Uint8Array> {
    const encoder = new TextEncoder();
    yield encoder.encode(`\uFEFF${csvHeader().join(',')}\r\n`);
    let cursor: string | undefined;
    let processed = 0;
    while (true) {
      const query = selectionQuery(selection, cursor);
      query.values.push(exportBatchSize);
      const result = await this.pool.query<CustomerExportDataRow>(
        `SELECT cp.id,
                coalesce(display.customer_name,cp.normalized_email) AS name,
                cp.normalized_email AS email,coalesce(cp.phone,saved_address.phone) AS phone,
                coalesce(customer_address.location,saved_address.location,order_address.location) AS location,
                cp.email_marketing_status,cp.sms_marketing_status,
                order_summary.order_count,order_summary.total_spent_cents,order_summary.last_order_at,
                coalesce(tags.values,ARRAY[]::text[]) AS tags,cp.created_at,cp.updated_at
         ${exportFromSql()} ${query.whereSql}
         ORDER BY cp.id ASC LIMIT $${query.values.length}`,
        query.values,
      );
      if (!result.rows.length) break;
      const csv = result.rows.map(csvRow).join('\r\n');
      yield encoder.encode(`${csv}\r\n`);
      processed += result.rows.length;
      cursor = result.rows.at(-1)!.id;
      if (exportId)
        await this.pool.query(
          `UPDATE app.customer_exports
           SET processed_count=LEAST($2,total_count),updated_at=now()
           WHERE id=$1 AND status='PROCESSING'`,
          [exportId, processed],
        );
      if (result.rows.length < exportBatchSize) break;
    }
  }

  private async audit(staffMemberId: string, eventType: string, metadata: object) {
    await this.pool.query(
      `INSERT INTO app.staff_audit_events (staff_member_id,event_type,metadata)
       VALUES ($1,$2,$3::jsonb)`,
      [staffMemberId, eventType, JSON.stringify(metadata)],
    );
  }
}

export function startCustomerExportConsumer(
  queue: BackgroundJobQueue,
  process: (exportId: string) => Promise<void>,
): Promise<QueueWorker> {
  return queue.process<ExportJobPayload>(customerExportQueueName, async (job) => {
    await process(job.payload.exportId);
  });
}

function exportFromSql() {
  return `FROM app.customer_profiles cp
    LEFT JOIN app.account_profiles profile ON profile.user_id=cp.user_id
    LEFT JOIN LATERAL (${customerProfileAddressSql()}) customer_address ON true
    LEFT JOIN LATERAL (${savedAddressSql()}) saved_address ON true
    LEFT JOIN LATERAL (${orderAddressSql()}) order_address ON true
    LEFT JOIN LATERAL (${orderSummarySql()}) order_summary ON true
    LEFT JOIN LATERAL (${tagsSql()}) tags ON true
    CROSS JOIN LATERAL (
      SELECT coalesce(nullif(trim(concat_ws(' ',cp.first_name,cp.last_name)),''),
                      nullif(trim(concat_ws(' ',profile.first_name,profile.last_name)),''),
                      customer_address.recipient_name,saved_address.recipient_name,
                      order_address.recipient_name) AS customer_name
    ) display`;
}

function selectionQuery(selection: CustomerExportSelection, cursor?: string) {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (selection.type === 'IDS') {
    where.push(`cp.id=ANY(${add(selection.customerIds)}::uuid[])`);
  } else {
    const filters = selection.filters;
    if (filters.query) {
      const position = add(`%${filters.query}%`);
      where.push(`(
        cp.normalized_email ILIKE ${position}
        OR display.customer_name ILIKE ${position}
        OR coalesce(cp.phone,saved_address.phone,'') ILIKE ${position}
        OR coalesce(customer_address.search_text,saved_address.search_text,order_address.search_text,'') ILIKE ${position}
      )`);
    }
    if (filters.location) {
      const position = add(`%${filters.location}%`);
      where.push(
        `coalesce(customer_address.location,saved_address.location,order_address.location,'') ILIKE ${position}`,
      );
    }
    if (filters.emailMarketingStatus)
      where.push(`cp.email_marketing_status=${add(filters.emailMarketingStatus)}`);
    if (filters.minOrders !== undefined)
      where.push(`order_summary.order_count >= ${add(filters.minOrders)}`);
    if (filters.view === 'RECENTLY_ADDED')
      where.push(`cp.first_seen_at >= now() - interval '${CUSTOMER_NEW_DAYS} days'`);
    if (filters.view === 'PROSPECTS') where.push('order_summary.order_count = 0');
    if (filters.view === 'FIRST_TIME') where.push('order_summary.order_count = 1');
    if (filters.view === 'RETURNING') where.push('order_summary.order_count >= 2');
    if (filters.view === 'HIGH_VALUE')
      where.push(`order_summary.total_spent_cents >= ${CUSTOMER_HIGH_VALUE_CENTS}`);
    if (filters.view === 'EMAIL_SUBSCRIBERS') where.push(`cp.email_marketing_status='SUBSCRIBED'`);
    if (selection.excludedCustomerIds?.length)
      where.push(`NOT (cp.id=ANY(${add(selection.excludedCustomerIds)}::uuid[]))`);
  }
  if (cursor) where.push(`cp.id > ${add(cursor)}::uuid`);
  return { values, whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

function normalizeSelection(input: unknown): CustomerExportSelection {
  if (!isRecord(input)) throw new CustomerExportValidationError('Choose customers to export.');
  if (input.type === 'IDS') {
    if (!Array.isArray(input.customerIds))
      throw new CustomerExportValidationError('Choose customers to export.');
    const customerIds = normalizeIds(input.customerIds, maximumExplicitSelection);
    return { type: 'IDS', customerIds };
  }
  if (input.type !== 'FILTER' || !isRecord(input.filters))
    throw new CustomerExportValidationError('Choose customers to export.');
  const raw = input.filters;
  const requestedView = raw.view === undefined ? 'ALL' : String(raw.view);
  const view = requestedView === 'NEW' ? 'RECENTLY_ADDED' : requestedView;
  if (!customerViews.includes(view as CustomerView))
    throw new CustomerExportValidationError('Unsupported customer view.');
  const emailMarketingStatus = raw.emailMarketingStatus;
  if (
    emailMarketingStatus !== undefined &&
    !marketingStatuses.includes(String(emailMarketingStatus) as MarketingStatus)
  )
    throw new CustomerExportValidationError('Unsupported email subscription status.');
  const minOrders = raw.minOrders === undefined ? undefined : Number(raw.minOrders);
  if (minOrders !== undefined && (!Number.isInteger(minOrders) || minOrders < 0))
    throw new CustomerExportValidationError('Enter a valid minimum order count.');
  const query = optionalText(raw.query, 200, 'search');
  const location = optionalText(raw.location, 160, 'location');
  const excludedCustomerIds = Array.isArray(input.excludedCustomerIds)
    ? normalizeIds(input.excludedCustomerIds, maximumExplicitSelection, true)
    : [];
  return {
    type: 'FILTER',
    filters: {
      view: view as CustomerView,
      ...(query ? { query } : {}),
      ...(location ? { location } : {}),
      ...(emailMarketingStatus
        ? { emailMarketingStatus: String(emailMarketingStatus) as MarketingStatus }
        : {}),
      ...(minOrders !== undefined ? { minOrders } : {}),
    },
    ...(excludedCustomerIds.length ? { excludedCustomerIds } : {}),
  };
}

function normalizeIds(values: unknown[], maximum: number, allowEmpty = false) {
  const ids = [
    ...new Set(values.map((value) => requireUuid(value, 'Invalid customer selection.'))),
  ];
  if ((!allowEmpty && !ids.length) || ids.length > maximum)
    throw new CustomerExportValidationError(
      `Choose between ${allowEmpty ? 0 : 1} and ${maximum.toLocaleString('en-US')} customers.`,
    );
  return ids;
}

function optionalText(value: unknown, maximum: number, label: string) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > maximum)
    throw new CustomerExportValidationError(`Enter a valid ${label}.`);
  return value.trim();
}

function requireUuid(value: unknown, message: string) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw new CustomerExportValidationError(message);
  return value;
}

function requireExportStaff(session: CustomerOperationsActor) {
  if (!('staffMemberId' in session) || !['OWNER', 'OPERATIONS'].includes(session.role))
    throw new CustomerExportAccessError('Customer export access is restricted.');
  return session;
}

function exportFileName() {
  return `customers-${new Date().toISOString().slice(0, 10)}.csv`;
}

function csvHeader() {
  return [
    'Name',
    'Email',
    'Phone',
    'Location',
    'Email subscription',
    'SMS subscription',
    'Orders',
    'Amount spent',
    'Last order',
    'Tags',
    'Date customer added',
    'Date customer updated',
  ];
}

function csvRow(row: CustomerExportDataRow) {
  return [
    row.name,
    row.email,
    row.phone,
    row.location,
    row.email_marketing_status,
    row.sms_marketing_status,
    row.order_count,
    (row.total_spent_cents / 100).toFixed(2),
    row.last_order_at?.toISOString() ?? '',
    row.tags.join('; '),
    row.created_at.toISOString(),
    row.updated_at.toISOString(),
  ]
    .map(escapeCustomerCsv)
    .join(',');
}

function concatenate(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function safeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : 'Customer export failed.';
  return message.slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireExportRow(row: CustomerExportRow | undefined) {
  if (!row) throw new CustomerExportValidationError('Export not found.');
  return row;
}

function mapSummary(row: CustomerExportRow): CustomerExportSummary {
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

function customerProfileAddressSql() {
  return `SELECT recipient_name,line1,line2,city,state_code,postal_code,country_code,phone,
                 concat_ws(' ',recipient_name,line1,line2,city,state_code,postal_code,country_code,phone) AS search_text,
                 concat_ws(', ',city,country_code) AS location
          FROM app.customer_addresses WHERE customer_profile_id=cp.id
          ORDER BY is_default DESC,updated_at DESC LIMIT 1`;
}

function savedAddressSql() {
  return `SELECT recipient_name,line1,line2,city,state_code,postal_code,country_code,phone,
                 concat_ws(' ',recipient_name,line1,line2,city,state_code,postal_code,country_code,phone) AS search_text,
                 concat_ws(', ',city,country_code) AS location
          FROM app.saved_addresses WHERE user_id=cp.user_id
          ORDER BY is_default DESC,updated_at DESC LIMIT 1`;
}

function orderAddressSql() {
  return `SELECT shipping_address_snapshot->>'recipientName' AS recipient_name,
                 concat_ws(' ',shipping_address_snapshot->>'recipientName',shipping_address_snapshot->>'line1',shipping_address_snapshot->>'line2',shipping_address_snapshot->>'city',shipping_address_snapshot->>'stateCode',shipping_address_snapshot->>'postalCode',shipping_address_snapshot->>'countryCode') AS search_text,
                 concat_ws(', ',shipping_address_snapshot->>'city',shipping_address_snapshot->>'countryCode') AS location
          FROM app.orders WHERE lower(trim(customer_email))=cp.normalized_email
          ORDER BY created_at DESC LIMIT 1`;
}

function orderSummarySql() {
  return `SELECT count(*)::int AS order_count,
                 coalesce(sum((pricing_snapshot->>'totalCents')::int),0)::int AS total_spent_cents,
                 max(created_at) AS last_order_at
          FROM app.orders WHERE lower(trim(customer_email))=cp.normalized_email
            AND status NOT IN ('DRAFT','PAYMENT_PENDING','CANCELLED','FAILED')`;
}

function tagsSql() {
  return `SELECT array_agg(tag.value ORDER BY tag.value) AS values
          FROM app.customer_profile_tags relation
          JOIN app.customer_tags tag ON tag.id=relation.customer_tag_id
          WHERE relation.customer_profile_id=cp.id`;
}

interface CustomerExportRow {
  id: string;
  requested_by_staff_member_id: string | null;
  status: CustomerExportStatus;
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

interface CustomerExportDataRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  email_marketing_status: MarketingStatus;
  sms_marketing_status: MarketingStatus;
  order_count: number;
  total_spent_cents: number;
  last_order_at: Date | null;
  tags: string[];
  created_at: Date;
  updated_at: Date;
}
