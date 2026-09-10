import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import type { ActiveSession } from './identity';
import type { StaffRole } from './staff-identity';

export type CustomerOperationsActor =
  | ActiveSession
  | { staffMemberId: string; role: StaffRole; email: string };

export type CustomerTouchpoint = 'ACCOUNT' | 'CHECKOUT' | 'ORDER' | 'NEWSLETTER';
export type CustomerSort = 'LAST_SEEN_DESC' | 'TOTAL_SPENT_DESC' | 'ORDER_COUNT_DESC' | 'NAME_ASC';

export class CustomerOperationsAccessError extends Error {}
export class CustomerOperationsValidationError extends Error {}

export interface OperationsCustomerListItem {
  id: string;
  email: string;
  name: string;
  orderCount: number;
  totalSpentCents: number;
  creditBalance: number;
  lastOrderAt: Date | null;
  lastSeenAt: Date;
  tags: string[];
}

export interface OperationsCustomerList {
  customers: OperationsCustomerListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface OperationsCustomerDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  customerSince: Date;
  lastSeenAt: Date;
  source: CustomerTouchpoint;
  orderCount: number;
  totalSpentCents: number;
  creditBalance: number;
  lastOrderAt: Date | null;
  savedDesignCount: number;
  marketingConsent: 'UNKNOWN';
  addresses: Array<{
    id: string;
    recipientName: string;
    line1: string;
    line2: string | null;
    city: string;
    stateCode: string;
    postalCode: string;
    countryCode: string;
    phone: string | null;
    isDefault: boolean;
    source: 'SAVED' | 'ORDER';
  }>;
  orders: Array<{
    orderNumber: string;
    status: string;
    itemCount: number;
    totalCents: number;
    createdAt: Date;
  }>;
  credits: Array<{
    id: string;
    entryType: string;
    amount: number;
    balanceAfter: number;
    createdAt: Date;
  }>;
  tags: string[];
  timeline: Array<{
    id: string;
    eventType: string;
    body: string | null;
    createdAt: Date;
  }>;
}

export interface CustomerListOptions {
  query?: string;
  page?: number;
  limit?: number;
  sort?: CustomerSort;
  tag?: string;
  minOrders?: number;
  minSpentCents?: number;
}

export async function recordCustomerTouchpoint(
  client: Pick<SqlClient, 'query'>,
  input: { email: string; source: CustomerTouchpoint; userId?: string | null },
): Promise<void> {
  const email = normalizeCustomerEmail(input.email);
  await client.query(
    `INSERT INTO app.customer_profiles (normalized_email, user_id, first_seen_source, first_seen_at, last_seen_at)
     VALUES ($1, (SELECT id FROM app.users WHERE id = $2::uuid AND lower(trim(email)) = $1), $3, now(), now())
     ON CONFLICT (normalized_email) DO UPDATE
     SET user_id = COALESCE(app.customer_profiles.user_id, EXCLUDED.user_id),
         last_seen_at = GREATEST(app.customer_profiles.last_seen_at, EXCLUDED.last_seen_at),
         updated_at = now()`,
    [email, input.userId ?? null, input.source],
  );
}

export async function reconcileCustomerProfiles(pool: SqlPool): Promise<void> {
  await pool.query(
    `INSERT INTO app.customer_profiles (
       normalized_email, user_id, first_seen_source, first_seen_at, last_seen_at
     )
     SELECT lower(trim(email)), id, 'ACCOUNT', created_at, created_at
     FROM app.users WHERE email_verified_at IS NOT NULL
     ON CONFLICT (normalized_email) DO UPDATE
     SET user_id = COALESCE(app.customer_profiles.user_id, EXCLUDED.user_id),
         first_seen_at = LEAST(app.customer_profiles.first_seen_at, EXCLUDED.first_seen_at),
         last_seen_at = GREATEST(app.customer_profiles.last_seen_at, EXCLUDED.last_seen_at),
         updated_at = now()`,
  );
  await pool.query(
    `INSERT INTO app.customer_profiles (
       normalized_email, user_id, first_seen_source, first_seen_at, last_seen_at
     )
     SELECT lower(trim(customer_email)), NULL::uuid, 'ORDER', min(created_at), max(created_at)
     FROM app.orders
     WHERE customer_email IS NOT NULL AND trim(customer_email) <> ''
     GROUP BY lower(trim(customer_email))
     ON CONFLICT (normalized_email) DO UPDATE
     SET user_id = COALESCE(app.customer_profiles.user_id, EXCLUDED.user_id),
         first_seen_at = LEAST(app.customer_profiles.first_seen_at, EXCLUDED.first_seen_at),
         last_seen_at = GREATEST(app.customer_profiles.last_seen_at, EXCLUDED.last_seen_at),
         updated_at = now()`,
  );
}

export class CustomerOperationsService {
  public constructor(private readonly pool: SqlPool) {}

  async listCustomers(
    session: CustomerOperationsActor,
    options: CustomerListOptions = {},
  ): Promise<OperationsCustomerList> {
    await this.requireStaff(session);
    await reconcileCustomerProfiles(this.pool);
    const page = boundedInteger(options.page, 1, 1, 10_000, 'page');
    const limit = boundedInteger(options.limit, 30, 1, 100, 'limit');
    const minOrders = optionalNonNegativeInteger(options.minOrders, 'minimum order count');
    const minSpentCents = optionalNonNegativeInteger(options.minSpentCents, 'minimum spend');
    const values: unknown[] = [];
    const where: string[] = [];
    if (options.query?.trim()) {
      values.push(`%${options.query.trim()}%`);
      const position = values.length;
      where.push(`(
        cp.normalized_email ILIKE $${position}
        OR coalesce(nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''), '') ILIKE $${position}
        OR EXISTS (
          SELECT 1 FROM app.saved_addresses search_address
          WHERE search_address.user_id = cp.user_id
            AND concat_ws(' ', search_address.recipient_name, search_address.line1, search_address.city,
                           search_address.state_code, search_address.postal_code, search_address.phone) ILIKE $${position}
        )
      )`);
    }
    if (options.tag?.trim()) {
      values.push(normalizeTag(options.tag));
      where.push(`EXISTS (
        SELECT 1 FROM app.customer_profile_tags tagged
        JOIN app.customer_tags tag ON tag.id = tagged.customer_tag_id
        WHERE tagged.customer_profile_id = cp.id AND tag.value = $${values.length}
      )`);
    }
    if (minOrders !== undefined) {
      values.push(minOrders);
      where.push(`order_summary.order_count >= $${values.length}`);
    }
    if (minSpentCents !== undefined) {
      values.push(minSpentCents);
      where.push(`order_summary.total_spent_cents >= $${values.length}`);
    }
    const orderBy = customerSortSql(options.sort ?? 'LAST_SEEN_DESC');
    values.push(limit, (page - 1) * limit);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await this.pool.query<CustomerListRow>(
      `SELECT cp.id, cp.normalized_email AS email, cp.last_seen_at,
              coalesce(nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                       saved_address.recipient_name, cp.normalized_email) AS name,
              order_summary.order_count, order_summary.total_spent_cents, order_summary.last_order_at,
              coalesce(credit.current_balance, 0) AS credit_balance,
              coalesce(tags.values, ARRAY[]::text[]) AS tags,
              count(*) OVER()::int AS total_count
       FROM app.customer_profiles cp
       LEFT JOIN app.account_profiles profile ON profile.user_id = cp.user_id
       LEFT JOIN LATERAL (
         SELECT recipient_name FROM app.saved_addresses
         WHERE user_id = cp.user_id ORDER BY is_default DESC, updated_at DESC LIMIT 1
       ) saved_address ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS order_count,
                coalesce(sum((pricing_snapshot ->> 'totalCents')::int), 0)::int AS total_spent_cents,
                max(created_at) AS last_order_at
         FROM app.orders WHERE lower(trim(customer_email)) = cp.normalized_email
       ) order_summary ON true
       LEFT JOIN app.credit_accounts credit
         ON credit.owner_type = 'USER' AND credit.owner_user_id = cp.user_id
       LEFT JOIN LATERAL (
         SELECT array_agg(tag.value ORDER BY tag.value) AS values
         FROM app.customer_profile_tags relation
         JOIN app.customer_tags tag ON tag.id = relation.customer_tag_id
         WHERE relation.customer_profile_id = cp.id
       ) tags ON true
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      customers: result.rows.map(mapListRow),
      total: result.rows[0]?.total_count ?? 0,
      page,
      limit,
    };
  }

  async getCustomer(session: CustomerOperationsActor, customerId: string): Promise<OperationsCustomerDetail> {
    await this.requireStaff(session);
    await reconcileCustomerProfiles(this.pool);
    const id = requireCustomerId(customerId);
    const identity = await this.pool.query<CustomerIdentityRow>(
      `SELECT cp.id, cp.normalized_email AS email, cp.user_id, cp.first_seen_source, cp.first_seen_at,
              cp.last_seen_at, coalesce(profile.first_name, '') AS first_name,
              coalesce(profile.last_name, '') AS last_name,
              coalesce(nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                       saved_address.recipient_name, cp.normalized_email) AS name,
              order_summary.order_count, order_summary.total_spent_cents, order_summary.last_order_at,
              coalesce(credit.current_balance, 0) AS credit_balance,
              coalesce(designs.count, 0)::int AS saved_design_count
       FROM app.customer_profiles cp
       LEFT JOIN app.account_profiles profile ON profile.user_id = cp.user_id
       LEFT JOIN LATERAL (
         SELECT recipient_name FROM app.saved_addresses
         WHERE user_id = cp.user_id ORDER BY is_default DESC, updated_at DESC LIMIT 1
       ) saved_address ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS order_count,
                coalesce(sum((pricing_snapshot ->> 'totalCents')::int), 0)::int AS total_spent_cents,
                max(created_at) AS last_order_at
         FROM app.orders WHERE lower(trim(customer_email)) = cp.normalized_email
       ) order_summary ON true
       LEFT JOIN app.credit_accounts credit
         ON credit.owner_type = 'USER' AND credit.owner_user_id = cp.user_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS count FROM app.projects
         WHERE owner_type = 'USER' AND owner_user_id = cp.user_id AND status <> 'ARCHIVED'
       ) designs ON true
       WHERE cp.id = $1`,
      [id],
    );
    const customer = identity.rows[0];
    if (!customer) throw new CustomerOperationsValidationError('Customer not found.');
    const [orders, addresses, credits, tags, timeline] = await Promise.all([
      this.pool.query<CustomerOrderRow>(
        `SELECT o.order_number, o.status, count(oi.id)::int AS item_count,
                coalesce((o.pricing_snapshot ->> 'totalCents')::int, 0) AS total_cents, o.created_at
         FROM app.orders o LEFT JOIN app.order_items oi ON oi.order_id = o.id
         WHERE lower(trim(o.customer_email)) = $1
         GROUP BY o.id ORDER BY o.created_at DESC LIMIT 50`,
        [customer.email],
      ),
      this.pool.query<CustomerAddressRow>(
        `SELECT id::text, recipient_name, line1, line2, city, state_code, postal_code, country_code,
                phone, is_default, 'SAVED'::text AS source
         FROM app.saved_addresses WHERE user_id = $1
         UNION ALL
         SELECT 'order:' || id::text,
                coalesce(shipping_address_snapshot ->> 'recipientName', ''),
                coalesce(shipping_address_snapshot ->> 'line1', ''),
                nullif(shipping_address_snapshot ->> 'line2', ''),
                coalesce(shipping_address_snapshot ->> 'city', ''),
                coalesce(shipping_address_snapshot ->> 'stateCode', ''),
                coalesce(shipping_address_snapshot ->> 'postalCode', ''),
                coalesce(shipping_address_snapshot ->> 'countryCode', 'US'),
                null, false, 'ORDER'::text
         FROM app.orders
         WHERE lower(trim(customer_email)) = $2
         ORDER BY is_default DESC, source ASC LIMIT 20`,
        [customer.user_id, customer.email],
      ),
      customer.user_id
        ? this.pool.query<CustomerCreditRow>(
            `SELECT ledger.id, ledger.entry_type, ledger.amount, ledger.balance_after, ledger.created_at
             FROM app.credit_ledger ledger JOIN app.credit_accounts account ON account.id = ledger.credit_account_id
             WHERE account.owner_type = 'USER' AND account.owner_user_id = $1
             ORDER BY ledger.created_at DESC LIMIT 100`,
            [customer.user_id],
          )
        : Promise.resolve({ rows: [] as CustomerCreditRow[] }),
      this.pool.query<{ value: string }>(
        `SELECT tag.value FROM app.customer_profile_tags relation
         JOIN app.customer_tags tag ON tag.id = relation.customer_tag_id
         WHERE relation.customer_profile_id = $1 ORDER BY tag.value`,
        [customer.id],
      ),
      this.pool.query<CustomerTimelineRow>(
        `SELECT id::text, event_type, body, created_at FROM app.customer_timeline_events
         WHERE customer_profile_id = $1
         UNION ALL
         SELECT id::text, 'LEGACY_NOTE', body, created_at FROM app.customer_notes
         WHERE lower(trim(customer_email)) = $2
         ORDER BY created_at DESC LIMIT 100`,
        [customer.id, customer.email],
      ),
    ]);
    return {
      id: customer.id,
      email: customer.email,
      firstName: customer.first_name,
      lastName: customer.last_name,
      name: customer.name,
      customerSince: customer.first_seen_at,
      lastSeenAt: customer.last_seen_at,
      source: customer.first_seen_source as CustomerTouchpoint,
      orderCount: customer.order_count,
      totalSpentCents: customer.total_spent_cents,
      creditBalance: customer.credit_balance,
      lastOrderAt: customer.last_order_at,
      savedDesignCount: customer.saved_design_count,
      marketingConsent: 'UNKNOWN',
      addresses: addresses.rows.map((row) => ({
        id: row.id,
        recipientName: row.recipient_name,
        line1: row.line1,
        line2: row.line2,
        city: row.city,
        stateCode: row.state_code,
        postalCode: row.postal_code,
        countryCode: row.country_code,
        phone: row.phone,
        isDefault: row.is_default,
        source: row.source as 'SAVED' | 'ORDER',
      })),
      orders: orders.rows.map((row) => ({
        orderNumber: row.order_number,
        status: row.status,
        itemCount: row.item_count,
        totalCents: row.total_cents,
        createdAt: row.created_at,
      })),
      credits: credits.rows.map((row) => ({
        id: row.id,
        entryType: row.entry_type,
        amount: row.amount,
        balanceAfter: row.balance_after,
        createdAt: row.created_at,
      })),
      tags: tags.rows.map((row) => row.value),
      timeline: timeline.rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        body: row.body,
        createdAt: row.created_at,
      })),
    };
  }

  async addNote(session: CustomerOperationsActor, customerId: string, body: string): Promise<void> {
    const actor = await this.requireStaff(session);
    const id = requireCustomerId(customerId);
    const note = body.trim();
    if (!note || note.length > 2_000)
      throw new CustomerOperationsValidationError('Enter an internal note of up to 2,000 characters.');
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO app.customer_timeline_events (customer_profile_id, event_type, body, actor_user_id, actor_staff_member_id)
       SELECT id, 'NOTE', $2, $3, $4 FROM app.customer_profiles WHERE id = $1 RETURNING id`,
      [id, note, actor.userId, actor.staffMemberId],
    );
    if (!inserted.rows[0]) throw new CustomerOperationsValidationError('Customer not found.');
  }

  async replaceTags(session: CustomerOperationsActor, customerId: string, values: string[]): Promise<string[]> {
    const actor = await this.requireStaff(session);
    const id = requireCustomerId(customerId);
    const tags = [...new Set(values.map(normalizeTag))];
    if (tags.length > 20) throw new CustomerOperationsValidationError('Use up to 20 customer tags.');
    await withTransaction(this.pool, async (client) => {
      const customer = await client.query<{ id: string }>(
        `SELECT id FROM app.customer_profiles WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!customer.rows[0]) throw new CustomerOperationsValidationError('Customer not found.');
      await client.query(`DELETE FROM app.customer_profile_tags WHERE customer_profile_id = $1`, [id]);
      for (const tag of tags) {
        const stored = await client.query<{ id: string }>(
          `INSERT INTO app.customer_tags (value) VALUES ($1)
           ON CONFLICT (value) DO UPDATE SET value = EXCLUDED.value RETURNING id`,
          [tag],
        );
        await client.query(
          `INSERT INTO app.customer_profile_tags (customer_profile_id, customer_tag_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, stored.rows[0]!.id],
        );
      }
      await client.query(
        `INSERT INTO app.customer_timeline_events (customer_profile_id, event_type, metadata, actor_user_id, actor_staff_member_id)
         VALUES ($1, 'TAGS_UPDATED', $2::jsonb, $3, $4)`,
        [id, JSON.stringify({ tags }), actor.userId, actor.staffMemberId],
      );
    });
    return tags;
  }

  private async requireStaff(session: CustomerOperationsActor): Promise<{ userId: string | null; staffMemberId: string | null }> {
    if ('staffMemberId' in session) {
      if (!['OWNER', 'OPERATIONS'].includes(session.role))
        throw new CustomerOperationsAccessError('Operations access is restricted.');
      return { userId: null, staffMemberId: session.staffMemberId };
    }
    if (!session.userId) throw new CustomerOperationsAccessError('Operations access is restricted.');
    const result = await this.pool.query<{ role: string }>(
      `SELECT role FROM app.users WHERE id = $1`,
      [session.userId],
    );
    if (!['ADMIN', 'CX_OPS'].includes(result.rows[0]?.role ?? ''))
      throw new CustomerOperationsAccessError('Operations access is restricted.');
    return { userId: session.userId, staffMemberId: null };
  }
}

interface CustomerListRow {
  id: string;
  email: string;
  name: string;
  order_count: number;
  total_spent_cents: number;
  credit_balance: number;
  last_order_at: Date | null;
  last_seen_at: Date;
  tags: string[];
  total_count: number;
}
interface CustomerIdentityRow {
  id: string;
  email: string;
  user_id: string | null;
  first_seen_source: string;
  first_seen_at: Date;
  last_seen_at: Date;
  first_name: string;
  last_name: string;
  name: string;
  order_count: number;
  total_spent_cents: number;
  last_order_at: Date | null;
  credit_balance: number;
  saved_design_count: number;
}
interface CustomerOrderRow { order_number: string; status: string; item_count: number; total_cents: number; created_at: Date }
interface CustomerAddressRow { id: string; recipient_name: string; line1: string; line2: string | null; city: string; state_code: string; postal_code: string; country_code: string; phone: string | null; is_default: boolean; source: string }
interface CustomerCreditRow { id: string; entry_type: string; amount: number; balance_after: number; created_at: Date }
interface CustomerTimelineRow { id: string; event_type: string; body: string | null; created_at: Date }

function mapListRow(row: CustomerListRow): OperationsCustomerListItem {
  return { id: row.id, email: row.email, name: row.name, orderCount: row.order_count, totalSpentCents: row.total_spent_cents, creditBalance: row.credit_balance, lastOrderAt: row.last_order_at, lastSeenAt: row.last_seen_at, tags: row.tags };
}
function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) throw new CustomerOperationsValidationError(`Enter a valid ${label}.`);
  return result;
}
function optionalNonNegativeInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) throw new CustomerOperationsValidationError(`Enter a valid ${label}.`);
  return value;
}
function normalizeCustomerEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new CustomerOperationsValidationError('Enter a valid customer email.');
  return email;
}
function normalizeTag(value: string): string {
  const tag = value.trim().replace(/\s+/g, ' ');
  if (!tag || tag.length > 48) throw new CustomerOperationsValidationError('Enter a customer tag of up to 48 characters.');
  return tag;
}
function requireCustomerId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new CustomerOperationsValidationError('Customer not found.');
  return value;
}
function customerSortSql(sort: CustomerSort): string {
  if (sort === 'TOTAL_SPENT_DESC') return 'order_summary.total_spent_cents DESC, cp.last_seen_at DESC';
  if (sort === 'ORDER_COUNT_DESC') return 'order_summary.order_count DESC, cp.last_seen_at DESC';
  if (sort === 'NAME_ASC') return 'name ASC, cp.id ASC';
  return 'cp.last_seen_at DESC, cp.id DESC';
}
