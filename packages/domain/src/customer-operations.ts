import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import {
  CUSTOMER_HIGH_VALUE_CENTS,
  CUSTOMER_NEW_DAYS,
  customerSorts,
  customerViews,
  escapeCustomerCsv,
  marketingStatuses,
  normalizeCustomerEmail as normalizeEmailContract,
  normalizeCustomerTag,
  type CustomerProfileInput,
  type CustomerSort,
  type CustomerView,
  type MarketingStatus,
} from './customer-contracts';
import type { ActiveSession } from './identity';
import type { StaffRole } from './staff-identity';

export type CustomerOperationsActor =
  ActiveSession | { staffMemberId: string; role: StaffRole; email: string };
export type CustomerTouchpoint = 'ACCOUNT' | 'CHECKOUT' | 'ORDER' | 'NEWSLETTER';

export class CustomerOperationsAccessError extends Error {}
export class CustomerOperationsValidationError extends Error {}
export class CustomerOperationsConflictError extends Error {
  constructor(
    message: string,
    public readonly customerId: string,
  ) {
    super(message);
  }
}

export interface OperationsCustomerListItem {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  location: string | null;
  emailMarketingStatus: MarketingStatus;
  smsMarketingStatus: MarketingStatus;
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
  metrics: {
    totalCustomers: number;
    returningPercentage: number;
    averageLifetimeSpendCents: number;
    emailSubscribers: number;
  };
}

export interface OperationsCustomerDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  name: string;
  customerSince: Date;
  lastSeenAt: Date;
  source: CustomerTouchpoint;
  orderCount: number;
  totalSpentCents: number;
  averageOrderValueCents: number;
  creditBalance: number;
  lastOrderAt: Date | null;
  savedDesignCount: number;
  lastDesignAt: Date | null;
  emailMarketingStatus: MarketingStatus;
  smsMarketingStatus: MarketingStatus;
  /** Compatibility field for the legacy operations customer page. */
  marketingConsent: MarketingStatus;
  addresses: Array<{
    id: string;
    recipientName: string;
    line1: string;
    line2: string | null;
    city: string;
    stateCode: string | null;
    postalCode: string;
    countryCode: string;
    phone: string | null;
    isDefault: boolean;
    source: 'PROFILE' | 'SAVED' | 'ORDER';
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
  view?: CustomerView;
  tag?: string;
  location?: string;
  emailMarketingStatus?: MarketingStatus;
  smsMarketingStatus?: MarketingStatus;
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
    await this.requireReadStaff(session);
    await reconcileCustomerProfiles(this.pool);
    const page = boundedInteger(options.page, 1, 1, 10_000, 'page');
    const limit = boundedInteger(options.limit, 30, 1, 100, 'limit');
    const minOrders = optionalNonNegativeInteger(options.minOrders, 'minimum order count');
    const minSpentCents = optionalNonNegativeInteger(options.minSpentCents, 'minimum spend');
    const sort = options.sort ?? 'LAST_SEEN_DESC';
    const view = options.view ?? 'ALL';
    if (!customerSorts.includes(sort))
      throw new CustomerOperationsValidationError('Unsupported customer sort.');
    if (!customerViews.includes(view))
      throw new CustomerOperationsValidationError('Unsupported customer view.');
    const values: unknown[] = [];
    const where: string[] = [];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };

    if (options.query?.trim()) {
      const position = add(`%${options.query.trim()}%`);
      where.push(`(
        cp.normalized_email ILIKE ${position}
        OR display.customer_name ILIKE ${position}
        OR coalesce(cp.phone, saved_address.phone, '') ILIKE ${position}
        OR coalesce(customer_address.search_text, saved_address.search_text, order_address.search_text, '') ILIKE ${position}
      )`);
    }
    if (options.tag?.trim()) {
      const position = add(normalizeTag(options.tag));
      where.push(`EXISTS (
        SELECT 1 FROM app.customer_profile_tags tagged
        JOIN app.customer_tags tag ON tag.id = tagged.customer_tag_id
        WHERE tagged.customer_profile_id = cp.id AND tag.value = ${position}
      )`);
    }
    if (options.location?.trim()) {
      const position = add(`%${options.location.trim()}%`);
      where.push(
        `coalesce(customer_address.location, saved_address.location, order_address.location, '') ILIKE ${position}`,
      );
    }
    if (options.emailMarketingStatus) {
      requireMarketingStatus(options.emailMarketingStatus);
      where.push(`cp.email_marketing_status = ${add(options.emailMarketingStatus)}`);
    }
    if (options.smsMarketingStatus) {
      requireMarketingStatus(options.smsMarketingStatus);
      where.push(`cp.sms_marketing_status = ${add(options.smsMarketingStatus)}`);
    }
    if (minOrders !== undefined) where.push(`order_summary.order_count >= ${add(minOrders)}`);
    if (minSpentCents !== undefined)
      where.push(`order_summary.total_spent_cents >= ${add(minSpentCents)}`);
    if (view === 'NEW')
      where.push(`cp.first_seen_at >= now() - interval '${CUSTOMER_NEW_DAYS} days'`);
    if (view === 'RETURNING') where.push('order_summary.order_count >= 2');
    if (view === 'HIGH_VALUE')
      where.push(`order_summary.total_spent_cents >= ${CUSTOMER_HIGH_VALUE_CENTS}`);
    if (view === 'EMAIL_SUBSCRIBERS') where.push(`cp.email_marketing_status = 'SUBSCRIBED'`);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    values.push(limit, (page - 1) * limit);
    const result = await this.pool.query<CustomerListRow>(
      `SELECT cp.id, cp.normalized_email AS email, cp.last_seen_at,
              display.customer_name AS name, coalesce(cp.phone, saved_address.phone) AS phone,
              coalesce(customer_address.location, saved_address.location, order_address.location) AS location,
              cp.email_marketing_status, cp.sms_marketing_status,
              order_summary.order_count, order_summary.total_spent_cents, order_summary.last_order_at,
              coalesce(credit.current_balance, 0) AS credit_balance,
              coalesce(tags.values, ARRAY[]::text[]) AS tags,
              count(*) OVER()::int AS total_count
       FROM app.customer_profiles cp
       LEFT JOIN app.account_profiles profile ON profile.user_id = cp.user_id
       LEFT JOIN LATERAL (${customerProfileAddressSql()}) customer_address ON true
       LEFT JOIN LATERAL (${savedAddressSql()}) saved_address ON true
       LEFT JOIN LATERAL (${orderAddressSql()}) order_address ON true
       LEFT JOIN LATERAL (${orderSummarySql()}) order_summary ON true
       LEFT JOIN app.credit_accounts credit
         ON credit.owner_type = 'USER' AND credit.owner_user_id = cp.user_id
       LEFT JOIN LATERAL (${tagsSql()}) tags ON true
       CROSS JOIN LATERAL (
         SELECT coalesce(nullif(trim(concat_ws(' ', cp.first_name, cp.last_name)), ''),
                         nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                         customer_address.recipient_name, saved_address.recipient_name,
                         order_address.recipient_name, cp.normalized_email) AS customer_name
       ) display
       ${whereSql}
       ORDER BY ${customerSortSql(sort)}
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const metricsResult = await this.pool.query<CustomerMetricsRow>(
      `SELECT count(*)::int AS total_customers,
              coalesce(round(100.0 * count(*) FILTER (WHERE summary.order_count >= 2)
                / nullif(count(*) FILTER (WHERE summary.order_count >= 1), 0)), 0)::int AS returning_percentage,
              coalesce(round(avg(summary.total_spent_cents) FILTER (WHERE summary.order_count >= 1)), 0)::int AS average_lifetime_spend_cents,
              count(*) FILTER (WHERE cp.email_marketing_status = 'SUBSCRIBED')::int AS email_subscribers
       FROM app.customer_profiles cp
       LEFT JOIN LATERAL (${orderSummarySql('summary')}) summary ON true`,
    );
    const metrics = metricsResult.rows[0]!;
    return {
      customers: result.rows.map(mapListRow),
      total: result.rows[0]?.total_count ?? 0,
      page,
      limit,
      metrics: {
        totalCustomers: metrics.total_customers,
        returningPercentage: metrics.returning_percentage,
        averageLifetimeSpendCents: metrics.average_lifetime_spend_cents,
        emailSubscribers: metrics.email_subscribers,
      },
    };
  }

  async getCustomer(
    session: CustomerOperationsActor,
    customerId: string,
  ): Promise<OperationsCustomerDetail> {
    await this.requireReadStaff(session);
    await reconcileCustomerProfiles(this.pool);
    const id = requireCustomerId(customerId);
    const identity = await this.pool.query<CustomerIdentityRow>(
      `SELECT cp.id, cp.normalized_email AS email, cp.user_id, cp.first_seen_source, cp.first_seen_at,
              cp.last_seen_at, coalesce(cp.first_name, profile.first_name, '') AS first_name,
              coalesce(cp.last_name, profile.last_name, '') AS last_name,
              coalesce(cp.phone, saved_address.phone) AS phone,
              cp.email_marketing_status, cp.sms_marketing_status,
              coalesce(nullif(trim(concat_ws(' ', cp.first_name, cp.last_name)), ''),
                       nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                       profile_address.recipient_name, saved_address.recipient_name,
                       cp.normalized_email) AS name,
              order_summary.order_count, order_summary.total_spent_cents,
              order_summary.last_order_at, coalesce(credit.current_balance, 0) AS credit_balance,
              coalesce(designs.count, 0)::int AS saved_design_count, designs.last_design_at
       FROM app.customer_profiles cp
       LEFT JOIN app.account_profiles profile ON profile.user_id = cp.user_id
       LEFT JOIN LATERAL (${customerProfileAddressSql()}) profile_address ON true
       LEFT JOIN LATERAL (${savedAddressSql()}) saved_address ON true
       LEFT JOIN LATERAL (${orderSummarySql()}) order_summary ON true
       LEFT JOIN app.credit_accounts credit
         ON credit.owner_type = 'USER' AND credit.owner_user_id = cp.user_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS count, max(updated_at) AS last_design_at FROM app.projects
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
                phone, is_default, 'PROFILE'::text AS source
         FROM app.customer_addresses WHERE customer_profile_id = $1
         UNION ALL
         SELECT id::text, recipient_name, line1, line2, city, state_code, postal_code, country_code,
                phone, is_default, 'SAVED'::text AS source
         FROM app.saved_addresses WHERE user_id = $2
           AND NOT EXISTS (SELECT 1 FROM app.customer_addresses WHERE customer_profile_id = $1)
         UNION ALL
         SELECT 'order:' || id::text,
                coalesce(shipping_address_snapshot ->> 'recipientName', ''),
                coalesce(shipping_address_snapshot ->> 'line1', ''),
                nullif(shipping_address_snapshot ->> 'line2', ''),
                coalesce(shipping_address_snapshot ->> 'city', ''),
                nullif(shipping_address_snapshot ->> 'stateCode', ''),
                coalesce(shipping_address_snapshot ->> 'postalCode', ''),
                coalesce(shipping_address_snapshot ->> 'countryCode', 'US'),
                null, false, 'ORDER'::text
         FROM app.orders WHERE lower(trim(customer_email)) = $3
           AND NOT EXISTS (SELECT 1 FROM app.customer_addresses WHERE customer_profile_id = $1)
           AND NOT EXISTS (SELECT 1 FROM app.saved_addresses WHERE user_id = $2)
         ORDER BY is_default DESC, source ASC LIMIT 20`,
        [customer.id, customer.user_id, customer.email],
      ),
      customer.user_id
        ? this.pool.query<CustomerCreditRow>(
            `SELECT ledger.id, ledger.entry_type, ledger.amount, ledger.balance_after,
                    ledger.created_at
             FROM app.credit_ledger ledger
             JOIN app.credit_accounts account ON account.id = ledger.credit_account_id
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
      phone: customer.phone,
      name: customer.name,
      customerSince: customer.first_seen_at,
      lastSeenAt: customer.last_seen_at,
      source: customer.first_seen_source as CustomerTouchpoint,
      orderCount: customer.order_count,
      totalSpentCents: customer.total_spent_cents,
      averageOrderValueCents: customer.order_count
        ? Math.round(customer.total_spent_cents / customer.order_count)
        : 0,
      creditBalance: customer.credit_balance,
      lastOrderAt: customer.last_order_at,
      savedDesignCount: customer.saved_design_count,
      lastDesignAt: customer.last_design_at,
      emailMarketingStatus: customer.email_marketing_status,
      smsMarketingStatus: customer.sms_marketing_status,
      marketingConsent: customer.email_marketing_status,
      addresses: addresses.rows.map(mapAddress),
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

  async createCustomer(
    session: CustomerOperationsActor,
    input: CustomerProfileInput,
  ): Promise<string> {
    const actor = await this.requireStaff(session);
    const profile = validateProfileInput(input);
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM app.customer_profiles WHERE normalized_email = $1`,
        [profile.email],
      );
      if (existing.rows[0])
        throw new CustomerOperationsConflictError(
          'A customer with this email already exists.',
          existing.rows[0].id,
        );
      const created = await client.query<{ id: string }>(
        `INSERT INTO app.customer_profiles (
           normalized_email, first_name, last_name, phone, first_seen_source,
           email_marketing_status, email_marketing_updated_at,
           sms_marketing_status, sms_marketing_updated_at
         ) VALUES ($1,$2,$3,$4,'ACCOUNT',$5,now(),$6,now()) RETURNING id`,
        [
          profile.email,
          profile.firstName,
          profile.lastName,
          profile.phone,
          profile.emailMarketingStatus,
          profile.smsMarketingStatus,
        ],
      );
      const id = created.rows[0]!.id;
      await this.writeAddress(client, id, profile);
      await this.writeTags(client, id, profile.tags);
      await client.query(
        `INSERT INTO app.customer_timeline_events
           (customer_profile_id,event_type,metadata,actor_staff_member_id,actor_user_id)
         VALUES ($1,'PROFILE_CREATED',$2::jsonb,$3,$4)`,
        [id, JSON.stringify({ source: 'ADMIN' }), actor.staffMemberId, actor.userId],
      );
      if (profile.note)
        await client.query(
          `INSERT INTO app.customer_timeline_events
             (customer_profile_id,event_type,body,actor_staff_member_id,actor_user_id)
           VALUES ($1,'NOTE',$2,$3,$4)`,
          [id, profile.note, actor.staffMemberId, actor.userId],
        );
      return id;
    });
  }

  async updateCustomer(
    session: CustomerOperationsActor,
    customerId: string,
    input: CustomerProfileInput,
  ): Promise<void> {
    const actor = await this.requireStaff(session);
    const id = requireCustomerId(customerId);
    const profile = validateProfileInput(input);
    await withTransaction(this.pool, async (client) => {
      const current = await client.query<{
        id: string;
        user_id: string | null;
        email_marketing_status: MarketingStatus;
        sms_marketing_status: MarketingStatus;
      }>(
        `SELECT id,user_id,email_marketing_status,sms_marketing_status
         FROM app.customer_profiles WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!current.rows[0]) throw new CustomerOperationsValidationError('Customer not found.');
      const duplicate = await client.query<{ id: string }>(
        `SELECT id FROM app.customer_profiles WHERE normalized_email=$1 AND id<>$2`,
        [profile.email, id],
      );
      if (duplicate.rows[0])
        throw new CustomerOperationsConflictError(
          'A customer with this email already exists.',
          duplicate.rows[0].id,
        );
      if (
        (profile.emailMarketingStatus === 'SUBSCRIBED' ||
          profile.smsMarketingStatus === 'SUBSCRIBED') &&
        current.rows[0].user_id
      ) {
        const suppressed = await client.query<{ blocked: boolean }>(
          `SELECT (marketing_suppressed_at IS NOT NULL) AS blocked
           FROM app.privacy_subject_controls WHERE user_id=$1`,
          [current.rows[0].user_id],
        );
        if (suppressed.rows[0]?.blocked)
          throw new CustomerOperationsValidationError(
            'Marketing subscription is unavailable for this customer.',
          );
      }
      await client.query(
        `UPDATE app.customer_profiles
         SET normalized_email=$2,first_name=$3,last_name=$4,phone=$5,
             email_marketing_status=$6,email_marketing_updated_at=now(),
             sms_marketing_status=$7,sms_marketing_updated_at=now(),updated_at=now()
         WHERE id=$1`,
        [
          id,
          profile.email,
          profile.firstName,
          profile.lastName,
          profile.phone,
          profile.emailMarketingStatus,
          profile.smsMarketingStatus,
        ],
      );
      const consentChanged =
        current.rows[0].email_marketing_status !== profile.emailMarketingStatus ||
        current.rows[0].sms_marketing_status !== profile.smsMarketingStatus;
      await this.writeAddress(client, id, profile, true);
      if (input.tags) await this.writeTags(client, id, profile.tags, true);
      await client.query(
        `INSERT INTO app.customer_timeline_events
           (customer_profile_id,event_type,metadata,actor_staff_member_id,actor_user_id)
         VALUES ($1,'PROFILE_UPDATED',$2::jsonb,$3,$4)`,
        [id, JSON.stringify({ source: 'ADMIN' }), actor.staffMemberId, actor.userId],
      );
      if (consentChanged)
        await client.query(
          `INSERT INTO app.customer_timeline_events
             (customer_profile_id,event_type,metadata,actor_staff_member_id,actor_user_id)
           VALUES ($1,'CONSENT_UPDATED',$2::jsonb,$3,$4)`,
          [
            id,
            JSON.stringify({
              emailMarketingStatus: profile.emailMarketingStatus,
              smsMarketingStatus: profile.smsMarketingStatus,
              source: 'ADMIN',
            }),
            actor.staffMemberId,
            actor.userId,
          ],
        );
    });
  }

  async addNote(session: CustomerOperationsActor, customerId: string, body: string): Promise<void> {
    const actor = await this.requireStaff(session);
    const id = requireCustomerId(customerId);
    const note = normalizeNote(body);
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO app.customer_timeline_events
         (customer_profile_id,event_type,body,actor_user_id,actor_staff_member_id)
       SELECT id,'NOTE',$2,$3,$4 FROM app.customer_profiles WHERE id=$1 RETURNING id`,
      [id, note, actor.userId, actor.staffMemberId],
    );
    if (!inserted.rows[0]) throw new CustomerOperationsValidationError('Customer not found.');
  }

  async replaceTags(
    session: CustomerOperationsActor,
    customerId: string,
    values: string[],
  ): Promise<string[]> {
    const actor = await this.requireStaff(session);
    const id = requireCustomerId(customerId);
    const tags = normalizeTags(values);
    await withTransaction(this.pool, async (client) => {
      const customer = await client.query<{ id: string }>(
        `SELECT id FROM app.customer_profiles WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!customer.rows[0]) throw new CustomerOperationsValidationError('Customer not found.');
      await this.writeTags(client, id, tags, true);
      await this.writeTagsTimeline(client, [id], tags, 'REPLACE', actor);
    });
    return tags;
  }

  async bulkTags(
    session: CustomerOperationsActor,
    customerIds: string[],
    values: string[],
    operation: 'ADD' | 'REMOVE',
  ): Promise<number> {
    const actor = await this.requireStaff(session);
    const ids = normalizeCustomerIds(customerIds);
    const tags = normalizeTags(values);
    if (!tags.length)
      throw new CustomerOperationsValidationError('Choose at least one customer tag.');
    return withTransaction(this.pool, async (client) => {
      const locked = await client.query<{ id: string }>(
        `SELECT id FROM app.customer_profiles WHERE id = ANY($1::uuid[]) FOR UPDATE`,
        [ids],
      );
      if (locked.rows.length !== ids.length)
        throw new CustomerOperationsValidationError('One or more customers were not found.');
      if (operation === 'ADD') {
        for (const tag of tags) {
          const stored = await this.ensureTag(client, tag);
          await client.query(
            `INSERT INTO app.customer_profile_tags (customer_profile_id,customer_tag_id)
             SELECT unnest($1::uuid[]),$2::uuid ON CONFLICT DO NOTHING`,
            [ids, stored],
          );
        }
      } else {
        await client.query(
          `DELETE FROM app.customer_profile_tags relation USING app.customer_tags tag
           WHERE relation.customer_tag_id=tag.id
             AND relation.customer_profile_id=ANY($1::uuid[])
             AND tag.value=ANY($2::text[])`,
          [ids, tags],
        );
      }
      await this.writeTagsTimeline(client, ids, tags, operation, actor);
      return ids.length;
    });
  }

  async exportCustomers(session: CustomerOperationsActor, customerIds: string[]): Promise<string> {
    const actor = await this.requireStaff(session);
    const ids = normalizeCustomerIds(customerIds);
    const result = await this.pool.query<CustomerExportRow>(
      `SELECT cp.id,
              coalesce(nullif(trim(concat_ws(' ',cp.first_name,cp.last_name)),''),cp.normalized_email) AS name,
              cp.normalized_email AS email,cp.phone,cp.email_marketing_status,
              cp.sms_marketing_status,coalesce(addr.city,'') AS city,
              coalesce(addr.country_code,'') AS country_code,
              coalesce(summary.order_count,0)::int AS order_count,
              coalesce(summary.total_spent_cents,0)::int AS total_spent_cents,
              summary.last_order_at,coalesce(tags.values,ARRAY[]::text[]) AS tags
       FROM app.customer_profiles cp
       LEFT JOIN LATERAL (${customerProfileAddressSql()}) addr ON true
       LEFT JOIN LATERAL (${orderSummarySql('summary')}) summary ON true
       LEFT JOIN LATERAL (${tagsSql()}) tags ON true
       WHERE cp.id=ANY($1::uuid[]) ORDER BY name`,
      [ids],
    );
    await this.pool.query(
      `INSERT INTO app.staff_audit_events (staff_member_id,event_type,metadata)
       VALUES ($1,'CUSTOMERS_EXPORTED',$2::jsonb)`,
      [actor.staffMemberId, JSON.stringify({ count: result.rows.length })],
    );
    const header = [
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
    ];
    const rows = result.rows.map((row) => [
      row.name,
      row.email,
      row.phone,
      [row.city, row.country_code].filter(Boolean).join(', '),
      row.email_marketing_status,
      row.sms_marketing_status,
      row.order_count,
      (row.total_spent_cents / 100).toFixed(2),
      row.last_order_at?.toISOString() ?? '',
      row.tags.join('; '),
    ]);
    return [header, ...rows].map((row) => row.map(escapeCustomerCsv).join(',')).join('\r\n');
  }

  private async writeAddress(
    client: SqlClient,
    id: string,
    profile: ValidatedProfile,
    replace = false,
  ) {
    if (replace)
      await client.query(`DELETE FROM app.customer_addresses WHERE customer_profile_id=$1`, [id]);
    if (!profile.address) return;
    await client.query(
      `INSERT INTO app.customer_addresses
       (customer_profile_id,recipient_name,line1,line2,city,state_code,postal_code,country_code,phone,is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
      [
        id,
        profile.name || profile.email,
        profile.address.line1,
        profile.address.line2,
        profile.address.city,
        profile.address.stateCode,
        profile.address.postalCode,
        profile.address.countryCode,
        profile.phone,
      ],
    );
  }

  private async writeTags(client: SqlClient, id: string, tags: string[], replace = false) {
    if (replace)
      await client.query(`DELETE FROM app.customer_profile_tags WHERE customer_profile_id=$1`, [
        id,
      ]);
    for (const tag of tags) {
      const tagId = await this.ensureTag(client, tag);
      await client.query(
        `INSERT INTO app.customer_profile_tags (customer_profile_id,customer_tag_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, tagId],
      );
    }
  }

  private async ensureTag(client: SqlClient, tag: string): Promise<string> {
    const stored = await client.query<{ id: string }>(
      `INSERT INTO app.customer_tags (value) VALUES ($1)
       ON CONFLICT (value) DO UPDATE SET value=EXCLUDED.value RETURNING id`,
      [tag],
    );
    return stored.rows[0]!.id;
  }

  private async writeTagsTimeline(
    client: SqlClient,
    ids: string[],
    tags: string[],
    operation: string,
    actor: { userId: string | null; staffMemberId: string | null },
  ) {
    await client.query(
      `INSERT INTO app.customer_timeline_events
       (customer_profile_id,event_type,metadata,actor_user_id,actor_staff_member_id)
       SELECT unnest($1::uuid[]),'TAGS_UPDATED',$2::jsonb,$3,$4`,
      [ids, JSON.stringify({ tags, operation }), actor.userId, actor.staffMemberId],
    );
  }

  private async requireStaff(
    session: CustomerOperationsActor,
  ): Promise<{ userId: string | null; staffMemberId: string | null }> {
    if ('staffMemberId' in session) {
      if (!['OWNER', 'OPERATIONS'].includes(session.role))
        throw new CustomerOperationsAccessError('Operations access is restricted.');
      return { userId: null, staffMemberId: session.staffMemberId };
    }
    if (!session.userId)
      throw new CustomerOperationsAccessError('Operations access is restricted.');
    const result = await this.pool.query<{ role: string }>(
      `SELECT role FROM app.users WHERE id=$1`,
      [session.userId],
    );
    if (!['ADMIN', 'CX_OPS'].includes(result.rows[0]?.role ?? ''))
      throw new CustomerOperationsAccessError('Operations access is restricted.');
    return { userId: session.userId, staffMemberId: null };
  }

  private async requireReadStaff(session: CustomerOperationsActor) {
    if ('staffMemberId' in session && session.role === 'READ_ONLY')
      return { userId: null, staffMemberId: session.staffMemberId };
    return this.requireStaff(session);
  }
}

type ValidatedProfile = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  phone: string | null;
  emailMarketingStatus: MarketingStatus;
  smsMarketingStatus: MarketingStatus;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    stateCode: string | null;
    postalCode: string;
    countryCode: string;
  } | null;
  tags: string[];
  note: string | null;
};

function validateProfileInput(input: CustomerProfileInput): ValidatedProfile {
  const email = normalizeCustomerEmail(input.email);
  const firstName = normalizeOptional(input.firstName, 80, 'first name');
  const lastName = normalizeOptional(input.lastName, 80, 'last name');
  const phone = normalizeOptional(input.phone, 40, 'phone');
  if (phone && !/^[+()\d][+()\d\s.-]{5,39}$/.test(phone))
    throw new CustomerOperationsValidationError('Enter a valid phone number.');
  const emailMarketingStatus = input.emailMarketingStatus ?? 'NOT_SUBSCRIBED';
  const smsMarketingStatus = input.smsMarketingStatus ?? 'NOT_SUBSCRIBED';
  requireMarketingStatus(emailMarketingStatus);
  requireMarketingStatus(smsMarketingStatus);
  const raw = input.address;
  const hasAddress = !!raw && Object.values(raw).some((value) => value?.trim());
  let address: ValidatedProfile['address'] = null;
  if (hasAddress) {
    const line1 = requiredText(raw?.line1, 240, 'address');
    const city = requiredText(raw?.city, 120, 'city');
    const postalCode = requiredText(raw?.postalCode, 32, 'postal code');
    const countryCode = requiredText(raw?.countryCode, 2, 'country or region').toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode))
      throw new CustomerOperationsValidationError('Choose a valid country or region.');
    address = {
      line1,
      city,
      postalCode,
      countryCode,
      line2: normalizeOptional(raw?.line2, 240, 'apartment'),
      stateCode: normalizeOptional(raw?.stateCode, 120, 'state or province'),
    };
  }
  return {
    email,
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' '),
    phone,
    emailMarketingStatus,
    smsMarketingStatus,
    address,
    tags: normalizeTags(input.tags ?? []),
    note: input.note ? normalizeNote(input.note) : null,
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
function orderSummarySql(alias = 'order_summary') {
  void alias;
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

interface CustomerListRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  location: string | null;
  email_marketing_status: MarketingStatus;
  sms_marketing_status: MarketingStatus;
  order_count: number;
  total_spent_cents: number;
  credit_balance: number;
  last_order_at: Date | null;
  last_seen_at: Date;
  tags: string[];
  total_count: number;
}
interface CustomerMetricsRow {
  total_customers: number;
  returning_percentage: number;
  average_lifetime_spend_cents: number;
  email_subscribers: number;
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
  phone: string | null;
  name: string;
  order_count: number;
  total_spent_cents: number;
  credit_balance: number;
  last_order_at: Date | null;
  saved_design_count: number;
  last_design_at: Date | null;
  email_marketing_status: MarketingStatus;
  sms_marketing_status: MarketingStatus;
}
interface CustomerOrderRow {
  order_number: string;
  status: string;
  item_count: number;
  total_cents: number;
  created_at: Date;
}
interface CustomerAddressRow {
  id: string;
  recipient_name: string;
  line1: string;
  line2: string | null;
  city: string;
  state_code: string | null;
  postal_code: string;
  country_code: string;
  phone: string | null;
  is_default: boolean;
  source: string;
}
interface CustomerCreditRow {
  id: string;
  entry_type: string;
  amount: number;
  balance_after: number;
  created_at: Date;
}
interface CustomerTimelineRow {
  id: string;
  event_type: string;
  body: string | null;
  created_at: Date;
}
interface CustomerExportRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  email_marketing_status: MarketingStatus;
  sms_marketing_status: MarketingStatus;
  city: string;
  country_code: string;
  order_count: number;
  total_spent_cents: number;
  last_order_at: Date | null;
  tags: string[];
}

function mapListRow(row: CustomerListRow): OperationsCustomerListItem {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    location: row.location,
    emailMarketingStatus: row.email_marketing_status,
    smsMarketingStatus: row.sms_marketing_status,
    orderCount: row.order_count,
    totalSpentCents: row.total_spent_cents,
    creditBalance: row.credit_balance,
    lastOrderAt: row.last_order_at,
    lastSeenAt: row.last_seen_at,
    tags: row.tags,
  };
}
function mapAddress(row: CustomerAddressRow): OperationsCustomerDetail['addresses'][number] {
  return {
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
    source: row.source as 'PROFILE' | 'SAVED' | 'ORDER',
  };
}
function normalizeCustomerEmail(value: string) {
  try {
    return normalizeEmailContract(value);
  } catch (error) {
    throw new CustomerOperationsValidationError(
      error instanceof Error ? error.message : 'Enter a valid customer email.',
    );
  }
}
function normalizeTag(value: string) {
  try {
    return normalizeCustomerTag(value);
  } catch (error) {
    throw new CustomerOperationsValidationError(
      error instanceof Error ? error.message : 'Enter a valid customer tag.',
    );
  }
}
function normalizeTags(values: string[]) {
  const tags = [...new Set(values.map(normalizeTag))];
  if (tags.length > 20) throw new CustomerOperationsValidationError('Use up to 20 customer tags.');
  return tags;
}
function normalizeCustomerIds(values: string[]) {
  const ids = [...new Set(values.map(requireCustomerId))];
  if (!ids.length || ids.length > 100)
    throw new CustomerOperationsValidationError('Choose between 1 and 100 customers.');
  return ids;
}
function normalizeNote(value: string) {
  const note = value.trim();
  if (!note || note.length > 2_000)
    throw new CustomerOperationsValidationError(
      'Enter an internal note of up to 2,000 characters.',
    );
  return note;
}
function normalizeOptional(value: string | undefined, max: number, label: string) {
  const normalized = value?.trim() || null;
  if (normalized && normalized.length > max)
    throw new CustomerOperationsValidationError(`Enter a ${label} of up to ${max} characters.`);
  return normalized;
}
function requiredText(value: string | undefined, max: number, label: string) {
  const normalized = normalizeOptional(value, max, label);
  if (!normalized) throw new CustomerOperationsValidationError(`Enter a valid ${label}.`);
  return normalized;
}
function requireMarketingStatus(value: string): asserts value is MarketingStatus {
  if (!marketingStatuses.includes(value as MarketingStatus))
    throw new CustomerOperationsValidationError('Choose a valid marketing status.');
}
function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max)
    throw new CustomerOperationsValidationError(`Enter a valid ${label}.`);
  return resolved;
}
function optionalNonNegativeInteger(value: number | undefined, label: string) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0)
    throw new CustomerOperationsValidationError(`Enter a valid ${label}.`);
  return value;
}
function requireCustomerId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new CustomerOperationsValidationError('Customer not found.');
  return value;
}
function customerSortSql(sort: CustomerSort) {
  if (sort === 'TOTAL_SPENT_DESC')
    return 'order_summary.total_spent_cents DESC,cp.last_seen_at DESC';
  if (sort === 'ORDER_COUNT_DESC') return 'order_summary.order_count DESC,cp.last_seen_at DESC';
  if (sort === 'NAME_ASC') return 'name ASC,cp.id ASC';
  return 'cp.last_seen_at DESC,cp.id DESC';
}
