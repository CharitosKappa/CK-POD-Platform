import { withTransaction, type SqlClient, type SqlPool } from '@let-it-be/db';

import {
  CUSTOMER_HIGH_VALUE_CENTS,
  CUSTOMER_NEW_DAYS,
  customerSorts,
  customerViews,
  escapeCustomerCsv,
  marketingStatuses,
  normalizeCustomerEmail as normalizeEmailContract,
  normalizeCustomerLocale,
  normalizeCustomerTag,
  type CustomerProfileInput,
  type CustomerAddressMutationInput,
  type CustomerLocale,
  type CustomerLocaleSource,
  type CustomerSort,
  type CustomerView,
  type MarketingStatus,
} from './customer-contracts';
import type { ActiveSession } from './identity';
import type { StaffRole } from './staff-identity';
import type { StoreCreditDirection, StoreCreditReason } from './store-credit';

export type CustomerOperationsActor =
  ActiveSession | { staffMemberId: string; role: StaffRole; email: string };
export type CustomerTouchpoint = 'ACCOUNT' | 'CHECKOUT' | 'ORDER' | 'NEWSLETTER';

const MAX_CUSTOMER_BULK_SELECTION = 10_000;

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
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
}

export interface OperationsCustomerList {
  customers: OperationsCustomerListItem[];
  total: number;
  page: number;
  limit: number;
  metrics: {
    totalCustomers: number;
    repeatCustomerRate: number;
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
  refundedOrderRate: number;
  creditBalance: number;
  storeCreditBalanceCents: number;
  storeCreditCurrency: 'USD';
  storeCreditTransactionCount: number;
  lastOrderAt: Date | null;
  savedDesignCount: number;
  lastDesignAt: Date | null;
  emailMarketingStatus: MarketingStatus;
  smsMarketingStatus: MarketingStatus;
  preferredLocale: CustomerLocale;
  preferredLocaleSource: CustomerLocaleSource;
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
    paymentStatus: string;
    itemCount: number;
    totalCents: number;
    createdAt: Date;
    items: Array<{
      productName: string;
      color: string;
      size: string;
      quantity: number;
      unitPriceCents: number;
      imageUrl: string | null;
    }>;
  }>;
  credits: Array<{
    id: string;
    entryType: string;
    amount: number;
    balanceAfter: number;
    createdAt: Date;
  }>;
  tags: string[];
  latestNote: string | null;
  timelineTotal: number;
  timeline: Array<{
    id: string;
    eventType: string;
    body: string | null;
    metadata: Record<string, unknown>;
    actorLabel: string | null;
    createdAt: Date;
  }>;
}

export interface StoreCreditLedgerOptions {
  page?: number;
  limit?: number;
}

export interface CustomerTimelineOptions {
  page?: number;
  limit?: number;
}

export interface OperationsCustomerTimelinePage {
  entries: OperationsCustomerDetail['timeline'];
  total: number;
  page: number;
  limit: number;
}

export interface OperationsStoreCreditLedger {
  balanceCents: number;
  currency: 'USD';
  total: number;
  page: number;
  limit: number;
  entries: Array<{
    id: string;
    entryType: StoreCreditDirection;
    amountCents: number;
    balanceAfterCents: number;
    reason: StoreCreditReason;
    note: string | null;
    actorLabel: string;
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
  input: {
    email: string;
    source: CustomerTouchpoint;
    userId?: string | null;
    preferredLocale?: CustomerLocale;
  },
): Promise<string> {
  const email = normalizeCustomerEmail(input.email);
  const preferredLocale = input.preferredLocale ?? 'en';
  const preferredLocaleSource = input.preferredLocale ? 'BROWSER' : 'DEFAULT';
  const result = await client.query<{ id: string }>(
    `INSERT INTO app.customer_profiles (
       normalized_email, user_id, first_seen_source, first_seen_at, last_seen_at,
       preferred_locale, preferred_locale_source, preferred_locale_updated_at
     )
     VALUES (
       $1, (SELECT id FROM app.users WHERE id = $2::uuid AND lower(trim(email)) = $1),
       $3, now(), now(), $4, $5, CASE WHEN $5 = 'BROWSER' THEN now() ELSE NULL END
     )
     ON CONFLICT (normalized_email) DO UPDATE
     SET user_id = COALESCE(app.customer_profiles.user_id, EXCLUDED.user_id),
         last_seen_at = GREATEST(app.customer_profiles.last_seen_at, EXCLUDED.last_seen_at),
         preferred_locale = CASE
           WHEN app.customer_profiles.preferred_locale_source IN ('ADMIN', 'CUSTOMER')
             THEN app.customer_profiles.preferred_locale
           WHEN EXCLUDED.preferred_locale_source = 'BROWSER' THEN EXCLUDED.preferred_locale
           ELSE app.customer_profiles.preferred_locale
         END,
         preferred_locale_source = CASE
           WHEN app.customer_profiles.preferred_locale_source IN ('ADMIN', 'CUSTOMER')
             THEN app.customer_profiles.preferred_locale_source
           WHEN EXCLUDED.preferred_locale_source = 'BROWSER' THEN 'BROWSER'
           ELSE app.customer_profiles.preferred_locale_source
         END,
         preferred_locale_updated_at = CASE
           WHEN app.customer_profiles.preferred_locale_source IN ('ADMIN', 'CUSTOMER')
             THEN app.customer_profiles.preferred_locale_updated_at
           WHEN EXCLUDED.preferred_locale_source = 'BROWSER' THEN now()
           ELSE app.customer_profiles.preferred_locale_updated_at
         END,
         updated_at = now()
     RETURNING id`,
    [email, input.userId ?? null, input.source, preferredLocale, preferredLocaleSource],
  );
  const profile = result.rows[0];
  if (!profile) throw new Error('Could not record customer profile touchpoint.');
  return profile.id;
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
         updated_at = now()
     WHERE app.customer_profiles.user_id IS DISTINCT FROM
             COALESCE(app.customer_profiles.user_id, EXCLUDED.user_id)
        OR app.customer_profiles.first_seen_at IS DISTINCT FROM
             LEAST(app.customer_profiles.first_seen_at, EXCLUDED.first_seen_at)
        OR app.customer_profiles.last_seen_at IS DISTINCT FROM
             GREATEST(app.customer_profiles.last_seen_at, EXCLUDED.last_seen_at)`,
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
         updated_at = now()
     WHERE app.customer_profiles.user_id IS DISTINCT FROM
             COALESCE(app.customer_profiles.user_id, EXCLUDED.user_id)
        OR app.customer_profiles.first_seen_at IS DISTINCT FROM
             LEAST(app.customer_profiles.first_seen_at, EXCLUDED.first_seen_at)
        OR app.customer_profiles.last_seen_at IS DISTINCT FROM
             GREATEST(app.customer_profiles.last_seen_at, EXCLUDED.last_seen_at)`,
  );
  await pool.query(
    `UPDATE app.orders orders
     SET customer_profile_id=customer.id,updated_at=now()
     FROM app.customer_profiles customer
     WHERE orders.customer_profile_id IS NULL
       AND lower(trim(orders.customer_email))=customer.normalized_email`,
  );
}

export class CustomerOperationsService {
  public constructor(private readonly pool: SqlPool) {}

  async listTags(session: CustomerOperationsActor): Promise<string[]> {
    await this.requireReadStaff(session);
    const result = await this.pool.query<{ value: string }>(
      `SELECT value FROM app.customer_tags ORDER BY lower(value), value`,
    );
    return result.rows.map((row) => row.value);
  }

  async listCustomers(
    session: CustomerOperationsActor,
    options: CustomerListOptions = {},
  ): Promise<OperationsCustomerList> {
    await this.requireReadStaff(session);
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
        OR (coalesce(cp.first_name, '') || ' ' || coalesce(cp.last_name, '')) ILIKE ${position}
        OR (coalesce(profile.first_name, '') || ' ' || coalesce(profile.last_name, '')) ILIKE ${position}
        OR coalesce(cp.phone, '') ILIKE ${position}
        OR EXISTS (
          SELECT 1 FROM app.customer_addresses search_address
          WHERE search_address.customer_profile_id=cp.id
            AND (${addressSearchDocumentSql('search_address')}) ILIKE ${position}
        )
        OR EXISTS (
          SELECT 1 FROM app.saved_addresses search_address
          WHERE search_address.user_id=cp.user_id
            AND (${addressSearchDocumentSql('search_address')}) ILIKE ${position}
        )
        OR EXISTS (
          SELECT 1 FROM app.orders search_order
          WHERE search_order.customer_profile_id=cp.id
            AND (${orderAddressSearchDocumentSql('search_order')}) ILIKE ${position}
        )
      )`);
    }
    if (options.tag?.trim()) {
      const position = add(normalizeTag(options.tag));
      where.push(`EXISTS (
        SELECT 1 FROM app.customer_profile_tags tagged
        JOIN app.customer_tags tag ON tag.id = tagged.customer_tag_id
        WHERE tagged.customer_profile_id = cp.id AND lower(tag.value) = lower(${position})
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
    if (minOrders !== undefined)
      where.push(`coalesce(order_summary.order_count, 0) >= ${add(minOrders)}`);
    if (minSpentCents !== undefined)
      where.push(`order_summary.total_spent_cents >= ${add(minSpentCents)}`);
    if (view === 'RECENTLY_ADDED')
      where.push(`cp.first_seen_at >= now() - interval '${CUSTOMER_NEW_DAYS} days'`);
    if (view === 'PROSPECTS') where.push('coalesce(order_summary.order_count, 0) = 0');
    if (view === 'FIRST_TIME') where.push('coalesce(order_summary.order_count, 0) = 1');
    if (view === 'RETURNING') where.push('coalesce(order_summary.order_count, 0) >= 2');
    if (view === 'HIGH_VALUE')
      where.push(`order_summary.total_spent_cents >= ${CUSTOMER_HIGH_VALUE_CENTS}`);
    if (view === 'EMAIL_SUBSCRIBERS') where.push(`cp.email_marketing_status = 'SUBSCRIBED'`);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    values.push(limit, (page - 1) * limit);
    const result = await this.pool.query<CustomerListRow>(
      `WITH ${customerOrderSummariesCteSql()}
       SELECT cp.id, cp.normalized_email AS email, cp.last_seen_at, cp.created_at, cp.updated_at,
              coalesce(display.customer_name, cp.normalized_email) AS name,
              coalesce(cp.phone, saved_address.phone) AS phone,
              coalesce(customer_address.location, saved_address.location, order_address.location) AS location,
              cp.email_marketing_status, cp.sms_marketing_status,
              coalesce(order_summary.order_count, 0)::int AS order_count,
              coalesce(order_summary.total_spent_cents, 0)::int AS total_spent_cents,
              order_summary.last_order_at,
              coalesce(credit.current_balance, 0) AS credit_balance,
              coalesce(tags.values, ARRAY[]::text[]) AS tags,
              count(*) OVER()::int AS total_count
       FROM app.customer_profiles cp
       LEFT JOIN app.account_profiles profile ON profile.user_id = cp.user_id
       LEFT JOIN LATERAL (${customerProfileAddressSql()}) customer_address ON true
       LEFT JOIN LATERAL (${savedAddressSql()}) saved_address ON true
       LEFT JOIN LATERAL (${orderAddressSql()}) order_address ON true
       LEFT JOIN order_summaries order_summary ON order_summary.customer_profile_id=cp.id
       LEFT JOIN app.credit_accounts credit
         ON credit.owner_type = 'USER' AND credit.owner_user_id = cp.user_id
       LEFT JOIN LATERAL (${tagsSql()}) tags ON true
       CROSS JOIN LATERAL (
         SELECT coalesce(nullif(trim(concat_ws(' ', cp.first_name, cp.last_name)), ''),
                         nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                         customer_address.recipient_name, saved_address.recipient_name,
                         order_address.recipient_name) AS customer_name
       ) display
       ${whereSql}
       ORDER BY ${customerSortSql(sort)}
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const metricsResult = await this.pool.query<CustomerMetricsRow>(
      `WITH ${customerOrderSummariesCteSql()}
       SELECT count(*)::int AS total_customers,
              coalesce(round(100.0 * count(*) FILTER (WHERE coalesce(summary.order_count, 0) >= 2)
                / nullif(count(*) FILTER (WHERE coalesce(summary.order_count, 0) >= 1), 0)), 0)::int AS repeat_customer_rate,
              coalesce(round(avg(summary.total_spent_cents) FILTER (WHERE coalesce(summary.order_count, 0) >= 1)), 0)::int AS average_lifetime_spend_cents,
              count(*) FILTER (WHERE cp.email_marketing_status = 'SUBSCRIBED')::int AS email_subscribers
       FROM app.customer_profiles cp
       LEFT JOIN order_summaries summary ON summary.customer_profile_id=cp.id`,
    );
    const metrics = metricsResult.rows[0]!;
    return {
      customers: result.rows.map(mapListRow),
      total: result.rows[0]?.total_count ?? 0,
      page,
      limit,
      metrics: {
        totalCustomers: metrics.total_customers,
        repeatCustomerRate: metrics.repeat_customer_rate,
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
    const id = requireCustomerId(customerId);
    const identity = await this.pool.query<CustomerIdentityRow>(
      `SELECT cp.id, cp.normalized_email AS email, cp.user_id, cp.first_seen_source, cp.first_seen_at,
              cp.last_seen_at, coalesce(cp.first_name, profile.first_name, '') AS first_name,
              coalesce(cp.last_name, profile.last_name, '') AS last_name,
              coalesce(cp.phone, saved_address.phone) AS phone,
              cp.email_marketing_status, cp.sms_marketing_status,
              cp.preferred_locale, cp.preferred_locale_source,
              coalesce(nullif(trim(concat_ws(' ', cp.first_name, cp.last_name)), ''),
                       nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                       profile_address.recipient_name, saved_address.recipient_name,
                       order_address.recipient_name,
                       cp.normalized_email) AS name,
              order_summary.order_count, order_summary.total_spent_cents,
              order_summary.returned_order_count,
              order_summary.last_order_at, coalesce(credit.current_balance, 0) AS credit_balance,
              coalesce(store_credit.current_balance_cents, 0)::int AS store_credit_balance_cents,
              coalesce(store_credit.currency, 'USD') AS store_credit_currency,
              coalesce((
                SELECT count(*)::int FROM app.store_credit_ledger store_credit_entry
                WHERE store_credit_entry.store_credit_account_id = store_credit.id
              ), 0)::int AS store_credit_transaction_count,
              coalesce(designs.count, 0)::int AS saved_design_count, designs.last_design_at
       FROM app.customer_profiles cp
       LEFT JOIN app.account_profiles profile ON profile.user_id = cp.user_id
       LEFT JOIN LATERAL (${customerProfileAddressSql()}) profile_address ON true
       LEFT JOIN LATERAL (${savedAddressSql()}) saved_address ON true
       LEFT JOIN LATERAL (${orderAddressSql()}) order_address ON true
       LEFT JOIN LATERAL (${orderSummarySql()}) order_summary ON true
       LEFT JOIN app.credit_accounts credit
         ON credit.owner_type = 'USER' AND credit.owner_user_id = cp.user_id
       LEFT JOIN app.store_credit_accounts store_credit
         ON store_credit.customer_profile_id = cp.id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS count, max(updated_at) AS last_design_at FROM app.projects
         WHERE owner_type = 'USER' AND owner_user_id = cp.user_id AND status <> 'ARCHIVED'
       ) designs ON true
       WHERE cp.id = $1`,
      [id],
    );
    const customer = identity.rows[0];
    if (!customer) throw new CustomerOperationsValidationError('Customer not found.');
    const [orders, addresses, credits, tags, timeline, latestNote] = await Promise.all([
      this.pool.query<CustomerOrderRow>(
        `SELECT o.order_number, o.status, coalesce(sum(oi.quantity), 0)::int AS item_count,
                coalesce((o.pricing_snapshot ->> 'totalCents')::int, 0) AS total_cents,
                coalesce(payment.status, 'UNKNOWN') AS payment_status, o.created_at,
                coalesce(jsonb_agg(jsonb_build_object(
                  'productName', model.display_name,
                  'color', coalesce(oi.item_snapshot ->> 'colorName', variant.color_name, oi.item_snapshot ->> 'colorCode', '—'),
                  'size', coalesce(oi.item_snapshot ->> 'size', oi.item_snapshot ->> 'sizeCode', variant.size, '—'),
                  'quantity', oi.quantity,
                  'unitPriceCents', coalesce((oi.item_snapshot ->> 'unitRetailCents')::int, variant.price_cents, 0),
                  'imageUrl', variant.image_url
                ) ORDER BY oi.created_at) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items
         FROM app.orders o
         LEFT JOIN app.order_items oi ON oi.order_id = o.id
         LEFT JOIN app.product_models model ON model.id = oi.product_model_id
         LEFT JOIN app.product_variants variant ON variant.id = oi.product_variant_id
         LEFT JOIN app.payments payment ON payment.checkout_attempt_id = o.checkout_attempt_id
         WHERE (o.customer_profile_id = $1
           OR (o.customer_profile_id IS NULL AND lower(trim(o.customer_email)) = $2))
         GROUP BY o.id, payment.status ORDER BY o.created_at DESC LIMIT 50`,
        [customer.id, customer.email],
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
         FROM app.orders WHERE (customer_profile_id = $1
           OR (customer_profile_id IS NULL AND lower(trim(customer_email)) = $3))
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
      customerTimeline(this.pool, customer, { page: 1, limit: 10 }),
      this.pool.query<{ body: string }>(
        `SELECT body FROM (
           SELECT event.body, event.created_at
           FROM app.customer_timeline_events event
           WHERE event.customer_profile_id=$1 AND event.event_type='NOTE' AND event.body IS NOT NULL
           UNION ALL
           SELECT note.body, note.created_at
           FROM app.customer_notes note
           WHERE lower(trim(note.customer_email))=$2
         ) notes
         ORDER BY created_at DESC
         LIMIT 1`,
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
      refundedOrderRate: customer.order_count
        ? Math.round((customer.returned_order_count / customer.order_count) * 100)
        : 0,
      creditBalance: customer.credit_balance,
      storeCreditBalanceCents: customer.store_credit_balance_cents,
      storeCreditCurrency: customer.store_credit_currency,
      storeCreditTransactionCount: customer.store_credit_transaction_count,
      lastOrderAt: customer.last_order_at,
      savedDesignCount: customer.saved_design_count,
      lastDesignAt: customer.last_design_at,
      emailMarketingStatus: customer.email_marketing_status,
      smsMarketingStatus: customer.sms_marketing_status,
      preferredLocale: customer.preferred_locale,
      preferredLocaleSource: customer.preferred_locale_source,
      marketingConsent: customer.email_marketing_status,
      addresses: addresses.rows.map(mapAddress),
      orders: orders.rows.map((row) => ({
        orderNumber: row.order_number,
        status: row.status,
        paymentStatus: row.payment_status,
        itemCount: row.item_count,
        totalCents: row.total_cents,
        createdAt: row.created_at,
        items: row.items.map((item) => ({
          productName: item.productName || 'Custom product',
          color: item.color,
          size: item.size,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          imageUrl: item.imageUrl,
        })),
      })),
      credits: credits.rows.map((row) => ({
        id: row.id,
        entryType: row.entry_type,
        amount: row.amount,
        balanceAfter: row.balance_after,
        createdAt: row.created_at,
      })),
      tags: tags.rows.map((row) => row.value),
      latestNote: latestNote.rows[0]?.body ?? null,
      timelineTotal: timeline.total,
      timeline: timeline.entries,
    };
  }

  async listCustomerTimeline(
    session: CustomerOperationsActor,
    customerId: string,
    options: CustomerTimelineOptions = {},
  ): Promise<OperationsCustomerTimelinePage> {
    await this.requireReadStaff(session);
    const id = requireCustomerId(customerId);
    const page = boundedInteger(options.page, 1, 1, 10_000, 'page');
    const limit = boundedInteger(options.limit, 10, 1, 100, 'limit');
    const customer = await this.pool.query<{ email: string; user_id: string | null }>(
      `SELECT normalized_email AS email, user_id
       FROM app.customer_profiles WHERE id=$1`,
      [id],
    );
    const identity = customer.rows[0];
    if (!identity) throw new CustomerOperationsValidationError('Customer not found.');
    return customerTimeline(this.pool, { id, ...identity }, { page, limit });
  }

  async listStoreCreditLedger(
    session: CustomerOperationsActor,
    customerId: string,
    options: StoreCreditLedgerOptions = {},
  ): Promise<OperationsStoreCreditLedger> {
    await this.requireReadStaff(session);
    const id = requireCustomerId(customerId);
    const page = boundedInteger(options.page, 1, 1, 10_000, 'page');
    const limit = boundedInteger(options.limit, 20, 1, 100, 'limit');
    const offset = (page - 1) * limit;
    const summary = await this.pool.query<StoreCreditLedgerSummaryRow>(
      `SELECT coalesce(account.current_balance_cents, 0)::int AS balance_cents,
              coalesce(account.currency, 'USD') AS currency,
              count(ledger.id)::int AS total_count
       FROM app.customer_profiles customer
       LEFT JOIN app.store_credit_accounts account ON account.customer_profile_id=customer.id
       LEFT JOIN app.store_credit_ledger ledger ON ledger.store_credit_account_id=account.id
       WHERE customer.id=$1
       GROUP BY account.current_balance_cents, account.currency`,
      [id],
    );
    const account = summary.rows[0];
    if (!account) throw new CustomerOperationsValidationError('Customer not found.');
    const entries = await this.pool.query<StoreCreditLedgerRow>(
      `SELECT ledger.id, ledger.entry_type, ledger.amount_cents,
              ledger.balance_after_cents, ledger.reason, ledger.note,
              staff.normalized_email AS actor_label, ledger.created_at
       FROM app.store_credit_ledger ledger
       JOIN app.store_credit_accounts account ON account.id=ledger.store_credit_account_id
       JOIN app.staff_members staff ON staff.id=ledger.actor_staff_member_id
       WHERE account.customer_profile_id=$1
       ORDER BY ledger.created_at DESC, ledger.id DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );
    return {
      balanceCents: account.balance_cents,
      currency: account.currency,
      total: account.total_count,
      page,
      limit,
      entries: entries.rows.map((row) => ({
        id: row.id,
        entryType: row.entry_type,
        amountCents: Math.abs(row.amount_cents),
        balanceAfterCents: row.balance_after_cents,
        reason: row.reason,
        note: row.note,
        actorLabel: row.actor_label,
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
           sms_marketing_status, sms_marketing_updated_at,
           preferred_locale, preferred_locale_source, preferred_locale_updated_at
         ) VALUES ($1,$2,$3,$4,'ACCOUNT',$5,now(),$6,now(),$7,'ADMIN',now()) RETURNING id`,
        [
          profile.email,
          profile.firstName,
          profile.lastName,
          profile.phone,
          profile.emailMarketingStatus,
          profile.smsMarketingStatus,
          profile.preferredLocale ?? 'en',
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
        normalized_email: string;
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
        email_marketing_status: MarketingStatus;
        sms_marketing_status: MarketingStatus;
        preferred_locale: CustomerLocale;
        address_recipient_name: string | null;
        address_phone: string | null;
        line1: string | null;
        line2: string | null;
        city: string | null;
        state_code: string | null;
        postal_code: string | null;
        country_code: string | null;
      }>(
        `SELECT profile.id,profile.user_id,profile.normalized_email,profile.first_name,
                profile.last_name,profile.phone,profile.email_marketing_status,
                profile.sms_marketing_status,profile.preferred_locale,
                address.recipient_name AS address_recipient_name,address.phone AS address_phone,
                address.line1,address.line2,address.city,
                address.state_code,address.postal_code,address.country_code
         FROM app.customer_profiles profile
         LEFT JOIN LATERAL (
           SELECT recipient_name,phone,line1,line2,city,state_code,postal_code,country_code
           FROM app.customer_addresses WHERE customer_profile_id=profile.id
           ORDER BY is_default DESC,updated_at DESC LIMIT 1
         ) address ON true
         WHERE profile.id=$1 FOR UPDATE OF profile`,
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
             sms_marketing_status=$7,sms_marketing_updated_at=now(),
             preferred_locale=coalesce($8,preferred_locale),
             preferred_locale_source=CASE WHEN $8::text IS NULL THEN preferred_locale_source ELSE 'ADMIN' END,
             preferred_locale_updated_at=CASE WHEN $8::text IS NULL THEN preferred_locale_updated_at ELSE now() END,
             updated_at=now()
         WHERE id=$1`,
        [
          id,
          profile.email,
          profile.firstName,
          profile.lastName,
          profile.phone,
          profile.emailMarketingStatus,
          profile.smsMarketingStatus,
          profile.preferredLocale,
        ],
      );
      const consentChanged =
        current.rows[0].email_marketing_status !== profile.emailMarketingStatus ||
        current.rows[0].sms_marketing_status !== profile.smsMarketingStatus;
      const changedFields = profileChangedFields(current.rows[0], profile);
      await this.writeAddress(client, id, profile, true);
      if (input.tags) await this.writeTags(client, id, profile.tags, true);
      if (changedFields.length)
        await client.query(
          `INSERT INTO app.customer_timeline_events
             (customer_profile_id,event_type,metadata,actor_staff_member_id,actor_user_id)
           VALUES ($1,'PROFILE_UPDATED',$2::jsonb,$3,$4)`,
          [
            id,
            JSON.stringify({ source: 'ADMIN', changedFields }),
            actor.staffMemberId,
            actor.userId,
          ],
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

  async createCustomerAddress(
    session: CustomerOperationsActor,
    customerId: string,
    input: CustomerAddressMutationInput,
  ): Promise<string> {
    const actor = await this.requireStaff(session);
    const id = requireCustomerId(customerId);
    const address = validateAddressInput(input);
    return withTransaction(this.pool, async (client) => {
      const customer = await client.query<{ id: string }>(
        `SELECT id FROM app.customer_profiles WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!customer.rows[0]) throw new CustomerOperationsValidationError('Customer not found.');
      const count = await client.query<{ address_count: number }>(
        `SELECT count(*)::int AS address_count FROM app.customer_addresses
         WHERE customer_profile_id=$1`,
        [id],
      );
      const isDefault = input.isDefault === true || (count.rows[0]?.address_count ?? 0) === 0;
      if (isDefault)
        await client.query(
          `UPDATE app.customer_addresses SET is_default=false,updated_at=now()
           WHERE customer_profile_id=$1 AND is_default=true`,
          [id],
        );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app.customer_addresses
           (customer_profile_id,recipient_name,line1,line2,city,state_code,postal_code,country_code,phone,is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          id,
          address.recipientName,
          address.line1,
          address.line2,
          address.city,
          address.stateCode,
          address.postalCode,
          address.countryCode,
          address.phone,
          isDefault,
        ],
      );
      const addressId = inserted.rows[0]?.id;
      if (!addressId) throw new Error('Could not create customer address.');
      await writeAddressTimeline(client, id, 'ADDRESS_ADDED', actor, {
        addressId,
        isDefault,
        city: address.city,
        countryCode: address.countryCode,
      });
      return addressId;
    });
  }

  async updateCustomerAddress(
    session: CustomerOperationsActor,
    customerId: string,
    addressId: string,
    input: CustomerAddressMutationInput,
  ): Promise<void> {
    const actor = await this.requireStaff(session);
    const id = requireCustomerId(customerId);
    const scopedAddressId = requireAddressId(addressId);
    const address = validateAddressInput(input);
    await withTransaction(this.pool, async (client) => {
      const existing = await client.query<{ id: string; is_default: boolean }>(
        `SELECT id,is_default FROM app.customer_addresses
         WHERE id=$1 AND customer_profile_id=$2 FOR UPDATE`,
        [scopedAddressId, id],
      );
      const current = existing.rows[0];
      if (!current) throw new CustomerOperationsValidationError('Customer address not found.');
      const isDefault = current.is_default || input.isDefault === true;
      if (isDefault)
        await client.query(
          `UPDATE app.customer_addresses SET is_default=false,updated_at=now()
           WHERE customer_profile_id=$1 AND id<>$2 AND is_default=true`,
          [id, scopedAddressId],
        );
      await client.query(
        `UPDATE app.customer_addresses
         SET recipient_name=$3,line1=$4,line2=$5,city=$6,state_code=$7,postal_code=$8,
             country_code=$9,phone=$10,is_default=$11,updated_at=now()
         WHERE id=$1 AND customer_profile_id=$2`,
        [
          scopedAddressId,
          id,
          address.recipientName,
          address.line1,
          address.line2,
          address.city,
          address.stateCode,
          address.postalCode,
          address.countryCode,
          address.phone,
          isDefault,
        ],
      );
      await writeAddressTimeline(client, id, 'ADDRESS_UPDATED', actor, {
        addressId: scopedAddressId,
        isDefault,
        city: address.city,
        countryCode: address.countryCode,
      });
    });
  }

  async deleteCustomerAddress(
    session: CustomerOperationsActor,
    customerId: string,
    addressId: string,
  ): Promise<void> {
    const actor = await this.requireStaff(session);
    const id = requireCustomerId(customerId);
    const scopedAddressId = requireAddressId(addressId);
    await withTransaction(this.pool, async (client) => {
      const removed = await client.query<{ id: string; is_default: boolean }>(
        `DELETE FROM app.customer_addresses
         WHERE id=$1 AND customer_profile_id=$2 RETURNING id,is_default`,
        [scopedAddressId, id],
      );
      const deleted = removed.rows[0];
      if (!deleted) throw new CustomerOperationsValidationError('Customer address not found.');
      let promotedAddressId: string | null = null;
      if (deleted.is_default) {
        const promoted = await client.query<{ id: string }>(
          `UPDATE app.customer_addresses SET is_default=true,updated_at=now()
           WHERE id=(
             SELECT id FROM app.customer_addresses WHERE customer_profile_id=$1
             ORDER BY updated_at DESC,id DESC LIMIT 1
           ) RETURNING id`,
          [id],
        );
        promotedAddressId = promoted.rows[0]?.id ?? null;
      }
      await writeAddressTimeline(client, id, 'ADDRESS_REMOVED', actor, {
        addressId: scopedAddressId,
        promotedAddressId,
      });
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
    const ids = normalizeCustomerIds(customerIds, MAX_CUSTOMER_BULK_SELECTION);
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
             AND lower(tag.value)=ANY($2::text[])`,
          [ids, tags.map((tag) => tag.toLocaleLowerCase('en-US'))],
        );
      }
      await this.writeTagsTimeline(client, ids, tags, operation, actor);
      return ids.length;
    });
  }

  async exportCustomers(session: CustomerOperationsActor, customerIds: string[]): Promise<string> {
    const actor = await this.requireStaff(session);
    const ids = normalizeCustomerIds(customerIds, MAX_CUSTOMER_BULK_SELECTION);
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
    if (!profile.address) {
      if (replace)
        await client.query(
          `DELETE FROM app.customer_addresses WHERE customer_profile_id=$1 AND is_default=true`,
          [id],
        );
      return;
    }
    await client.query(
      `INSERT INTO app.customer_addresses
       (customer_profile_id,recipient_name,line1,line2,city,state_code,postal_code,country_code,phone,is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
       ON CONFLICT (customer_profile_id) WHERE is_default DO UPDATE
       SET recipient_name=EXCLUDED.recipient_name,line1=EXCLUDED.line1,line2=EXCLUDED.line2,
           city=EXCLUDED.city,state_code=EXCLUDED.state_code,postal_code=EXCLUDED.postal_code,
           country_code=EXCLUDED.country_code,phone=EXCLUDED.phone,updated_at=now()`,
      [
        id,
        profile.address.recipientName || profile.name || profile.email,
        profile.address.line1,
        profile.address.line2,
        profile.address.city,
        profile.address.stateCode,
        profile.address.postalCode,
        profile.address.countryCode,
        profile.address.phone || profile.phone,
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
      `WITH existing AS (
         SELECT id FROM app.customer_tags WHERE lower(value)=lower($1) LIMIT 1
       ), inserted AS (
         INSERT INTO app.customer_tags (value)
         SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM existing)
         ON CONFLICT DO NOTHING RETURNING id
       )
       SELECT id FROM existing UNION ALL SELECT id FROM inserted LIMIT 1`,
      [tag],
    );
    const row = stored.rows[0];
    if (row) return row.id;
    const raced = await client.query<{ id: string }>(
      `SELECT id FROM app.customer_tags WHERE lower(value)=lower($1) LIMIT 1`,
      [tag],
    );
    if (!raced.rows[0]) throw new Error('Could not store customer tag.');
    return raced.rows[0].id;
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
  preferredLocale: CustomerLocale | null;
  address: {
    recipientName: string | null;
    phone: string | null;
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

type ValidatedAddress = NonNullable<ValidatedProfile['address']>;

async function writeAddressTimeline(
  client: SqlClient,
  customerId: string,
  eventType: 'ADDRESS_ADDED' | 'ADDRESS_UPDATED' | 'ADDRESS_REMOVED',
  actor: { userId: string | null; staffMemberId: string | null },
  metadata: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO app.customer_timeline_events
       (customer_profile_id,event_type,metadata,actor_user_id,actor_staff_member_id)
     VALUES ($1,$2,$3::jsonb,$4,$5)`,
    [customerId, eventType, JSON.stringify(metadata), actor.userId, actor.staffMemberId],
  );
}

async function customerTimeline(
  pool: SqlPool,
  customer: Pick<CustomerIdentityRow, 'id' | 'email' | 'user_id'>,
  options: Required<CustomerTimelineOptions>,
): Promise<OperationsCustomerTimelinePage> {
  const offset = (options.page - 1) * options.limit;
  const result = await pool.query<CustomerTimelinePageRow>(
    `WITH timeline AS (
       SELECT 'customer:' || event.id::text AS id, event.event_type::text, event.body,
              event.metadata, coalesce(staff.normalized_email, actor.email)::text AS actor_label,
              event.created_at
       FROM app.customer_timeline_events event
       LEFT JOIN app.staff_members staff ON staff.id=event.actor_staff_member_id
       LEFT JOIN app.users actor ON actor.id=event.actor_user_id
       WHERE event.customer_profile_id=$1
       UNION ALL
       SELECT 'legacy-note:' || note.id::text, 'LEGACY_NOTE'::text, note.body, '{}'::jsonb,
              actor.email::text, note.created_at
       FROM app.customer_notes note
       LEFT JOIN app.users actor ON actor.id=note.created_by_user_id
       WHERE lower(trim(note.customer_email))=$2
       UNION ALL
       SELECT 'order:' || orders.id::text, 'ORDER_PLACED'::text, NULL::text,
              jsonb_build_object('orderNumber',orders.order_number,'totalCents',
                coalesce((orders.pricing_snapshot->>'totalCents')::int,0),'status',orders.status),
              'Customer'::text, orders.created_at
       FROM app.orders orders
       WHERE (orders.customer_profile_id=$1 OR
         (orders.customer_profile_id IS NULL AND lower(trim(orders.customer_email))=$2))
       UNION ALL
       SELECT 'order-state:' || history.id::text, 'ORDER_STATUS_CHANGED'::text, history.reason,
              jsonb_build_object('orderNumber',orders.order_number,'fromState',history.from_state,
                'toState',history.to_state,'reasonCode',history.reason_code) || history.metadata,
              coalesce(staff.normalized_email,actor.email,initcap(lower(history.actor_type)))::text,
              history.created_at
       FROM app.order_state_history history
       JOIN app.orders orders ON orders.id=history.order_id
       LEFT JOIN app.staff_members staff ON staff.id=history.actor_staff_member_id
       LEFT JOIN app.users actor ON actor.id=history.actor_user_id
       WHERE (orders.customer_profile_id=$1 OR
         (orders.customer_profile_id IS NULL AND lower(trim(orders.customer_email))=$2))
       UNION ALL
       SELECT 'refund:' || refund.id::text, 'REFUND'::text, refund.notes,
              jsonb_build_object('orderNumber',orders.order_number,'amountCents',refund.amount_cents,
                'reasonCode',refund.reason_code,'status',refund.status), actor.email::text,
              refund.created_at
       FROM app.order_refunds refund
       JOIN app.orders orders ON orders.id=refund.order_id
       LEFT JOIN app.users actor ON actor.id=refund.initiated_by_user_id
       WHERE (orders.customer_profile_id=$1 OR
         (orders.customer_profile_id IS NULL AND lower(trim(orders.customer_email))=$2))
       UNION ALL
       SELECT 'reprint:' || reprint.id::text, 'REPRINT'::text, reprint.notes,
              jsonb_build_object('orderNumber',orders.order_number,'reasonCode',reprint.reason_code,
                'status',reprint.status,'estimatedCostCents',reprint.estimated_cost_cents),
              actor.email::text, reprint.created_at
       FROM app.order_reprints reprint
       JOIN app.orders orders ON orders.id=reprint.original_order_id
       LEFT JOIN app.users actor ON actor.id=reprint.created_by_user_id
       WHERE (orders.customer_profile_id=$1 OR
         (orders.customer_profile_id IS NULL AND lower(trim(orders.customer_email))=$2))
       UNION ALL
       SELECT 'credit:' || ledger.id::text, 'CREDIT_LEDGER'::text, NULL::text,
              jsonb_build_object('entryType',ledger.entry_type,'amount',ledger.amount,
                'balanceAfter',ledger.balance_after,'generationId',ledger.generation_id) || ledger.metadata,
              NULL::text, ledger.created_at
       FROM app.credit_ledger ledger
       JOIN app.credit_accounts account ON account.id=ledger.credit_account_id
       WHERE $3::uuid IS NOT NULL AND account.owner_type='USER' AND account.owner_user_id=$3::uuid
       UNION ALL
       SELECT 'store-credit:' || ledger.id::text, 'STORE_CREDIT_ADJUSTMENT'::text, ledger.note,
              jsonb_build_object('amountCents',ledger.amount_cents,'balanceAfterCents',
                ledger.balance_after_cents,'direction',ledger.entry_type,'reason',ledger.reason,
                'currency',account.currency), staff.normalized_email::text, ledger.created_at
       FROM app.store_credit_ledger ledger
       JOIN app.store_credit_accounts account ON account.id=ledger.store_credit_account_id
       JOIN app.staff_members staff ON staff.id=ledger.actor_staff_member_id
       WHERE account.customer_profile_id=$1
       UNION ALL
       SELECT 'generation:' || generation.id::text, 'DESIGN_GENERATION'::text,
              generation.raw_prompt,
              jsonb_build_object('status',generation.status,'creditStatus',generation.credit_status,
                'projectId',generation.project_id,'failureCategory',generation.failure_category),
              'Customer'::text, generation.created_at
       FROM app.generations generation
       WHERE $3::uuid IS NOT NULL AND generation.requested_by_user_id=$3::uuid
       UNION ALL
       SELECT 'delivery:' || delivery.id::text, 'EMAIL_DELIVERY'::text, NULL::text,
              jsonb_build_object('messageType',delivery.message_type,'classification',
                delivery.classification,'status',delivery.status,'orderNumber',orders.order_number),
              'System'::text, delivery.created_at
       FROM app.lifecycle_deliveries delivery
       LEFT JOIN app.orders orders ON orders.id=delivery.order_id
       WHERE orders.customer_profile_id=$1
          OR (orders.customer_profile_id IS NULL AND lower(trim(delivery.recipient_email))=$2)
          OR (orders.id IS NULL AND lower(trim(delivery.recipient_email))=$2)
     ), timeline_page AS (
       SELECT * FROM timeline ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5
     )
     SELECT (SELECT count(*)::int FROM timeline) AS total_count,
            coalesce(jsonb_agg(jsonb_build_object(
              'id',page.id,'eventType',page.event_type,'body',page.body,'metadata',page.metadata,
              'actorLabel',page.actor_label,'createdAt',page.created_at
            ) ORDER BY page.created_at DESC,page.id DESC)
              FILTER (WHERE page.id IS NOT NULL),'[]'::jsonb) AS entries
     FROM timeline_page page`,
    [customer.id, customer.email, customer.user_id, options.limit, offset],
  );
  const row = result.rows[0];
  return {
    entries: (row?.entries ?? []).map((entry) => ({
      ...entry,
      metadata: entry.metadata ?? {},
      createdAt: new Date(entry.createdAt),
    })),
    total: row?.total_count ?? 0,
    page: options.page,
    limit: options.limit,
  };
}

function profileChangedFields(
  current: {
    normalized_email: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    preferred_locale: CustomerLocale;
    address_recipient_name: string | null;
    address_phone: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state_code: string | null;
    postal_code: string | null;
    country_code: string | null;
  },
  profile: ValidatedProfile,
): string[] {
  const changed: string[] = [];
  if (current.normalized_email !== profile.email) changed.push('email');
  if (current.first_name !== profile.firstName) changed.push('first name');
  if (current.last_name !== profile.lastName) changed.push('last name');
  if (current.phone !== profile.phone) changed.push('phone');
  if (profile.preferredLocale && current.preferred_locale !== profile.preferredLocale)
    changed.push('preferred language');
  const previousAddress = [
    current.address_recipient_name,
    current.address_phone,
    current.line1,
    current.line2,
    current.city,
    current.state_code,
    current.postal_code,
    current.country_code,
  ].map((value) => value ?? '');
  const nextAddress = [
    profile.address?.recipientName,
    profile.address?.phone,
    profile.address?.line1,
    profile.address?.line2,
    profile.address?.city,
    profile.address?.stateCode,
    profile.address?.postalCode,
    profile.address?.countryCode,
  ].map((value) => value ?? '');
  if (previousAddress.some((value, index) => value !== nextAddress[index]))
    changed.push('default address');
  return changed;
}

function validateProfileInput(input: CustomerProfileInput): ValidatedProfile {
  const email = normalizeCustomerEmail(input.email);
  const firstName = normalizeOptional(input.firstName, 80, 'first name');
  const lastName = normalizeOptional(input.lastName, 80, 'last name');
  const phone = normalizeOptional(input.phone, 40, 'phone');
  if (phone && !/^[+()\d][+()\d\s.-]{5,39}$/.test(phone))
    throw new CustomerOperationsValidationError('Enter a valid phone number.');
  const emailMarketingStatus = input.emailMarketingStatus ?? 'NOT_SUBSCRIBED';
  const smsMarketingStatus = input.smsMarketingStatus ?? 'NOT_SUBSCRIBED';
  const preferredLocale = input.preferredLocale
    ? normalizeCustomerLocale(input.preferredLocale)
    : null;
  requireMarketingStatus(emailMarketingStatus);
  requireMarketingStatus(smsMarketingStatus);
  const raw = input.address;
  const hasAddress = !!raw && Object.values(raw).some((value) => value?.trim());
  let address: ValidatedProfile['address'] = null;
  if (hasAddress)
    address = validateAddressInput({
      ...raw,
      recipientName: raw.recipientName || [firstName, lastName].filter(Boolean).join(' ') || email,
    });
  return {
    email,
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' '),
    phone,
    emailMarketingStatus,
    smsMarketingStatus,
    preferredLocale,
    address,
    tags: normalizeTags(input.tags ?? []),
    note: input.note ? normalizeNote(input.note) : null,
  };
}

function validateAddressInput(input: CustomerAddressMutationInput): ValidatedAddress {
  const line1 = requiredText(input.line1, 240, 'address');
  const city = requiredText(input.city, 120, 'city');
  const postalCode = requiredText(input.postalCode, 32, 'postal code');
  const countryCode = requiredText(input.countryCode, 2, 'country or region').toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode))
    throw new CustomerOperationsValidationError('Choose a valid country or region.');
  const recipientName = requiredText(input.recipientName, 160, 'recipient name');
  const phone = normalizeOptional(input.phone, 40, 'address phone');
  if (phone && !/^[+()\d][+()\d\s.-]{5,39}$/.test(phone))
    throw new CustomerOperationsValidationError('Enter a valid address phone number.');
  return {
    recipientName,
    phone,
    line1,
    line2: normalizeOptional(input.line2, 240, 'apartment'),
    city,
    stateCode: normalizeOptional(input.stateCode, 120, 'state or province'),
    postalCode,
    countryCode,
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
          FROM app.orders orders
          WHERE (orders.customer_profile_id=cp.id
            OR (orders.customer_profile_id IS NULL
              AND lower(trim(orders.customer_email))=cp.normalized_email))
          ORDER BY orders.created_at DESC LIMIT 1`;
}
function orderSummarySql(alias = 'order_summary') {
  void alias;
  return `SELECT count(*)::int AS order_count,
                 coalesce(sum(greatest(
                   (orders.pricing_snapshot->>'totalCents')::int
                     - coalesce(succeeded_refund.refunded_cents, 0),
                   0
                 )),0)::int AS total_spent_cents,
                 max(orders.created_at) AS last_order_at,
                 count(*) FILTER (WHERE coalesce(succeeded_refund.refunded_cents, 0) > 0)::int
                   AS returned_order_count
          FROM app.orders orders
          LEFT JOIN LATERAL (
            SELECT coalesce(sum(refund.amount_cents), 0)::int AS refunded_cents
            FROM app.order_refunds refund
            WHERE refund.order_id=orders.id AND refund.status='SUCCEEDED'
          ) succeeded_refund ON true
          WHERE (orders.customer_profile_id=cp.id
            OR (orders.customer_profile_id IS NULL
              AND lower(trim(orders.customer_email))=cp.normalized_email))
            AND orders.status NOT IN ('DRAFT','PAYMENT_PENDING','CANCELLED','FAILED')`;
}

function customerOrderSummariesCteSql() {
  return `refunded_orders AS (
            SELECT refund.order_id, coalesce(sum(refund.amount_cents), 0)::int AS refunded_cents
            FROM app.order_refunds refund
            WHERE refund.status='SUCCEEDED'
            GROUP BY refund.order_id
          ),
          order_summaries AS (
            SELECT orders.customer_profile_id,
                   count(*)::int AS order_count,
                   coalesce(sum(greatest(
                     (orders.pricing_snapshot->>'totalCents')::int
                       - coalesce(refunded_orders.refunded_cents, 0),
                     0
                   )), 0)::int AS total_spent_cents,
                   max(orders.created_at) AS last_order_at,
                   count(*) FILTER (WHERE coalesce(refunded_orders.refunded_cents, 0) > 0)::int
                     AS returned_order_count
            FROM app.orders orders
            LEFT JOIN refunded_orders ON refunded_orders.order_id=orders.id
            WHERE orders.customer_profile_id IS NOT NULL
              AND orders.status NOT IN ('DRAFT','PAYMENT_PENDING','CANCELLED','FAILED')
            GROUP BY orders.customer_profile_id
          )`;
}

function addressSearchDocumentSql(alias: string) {
  return `coalesce(${alias}.recipient_name, '') || ' ' || coalesce(${alias}.line1, '') || ' ' ||
          coalesce(${alias}.line2, '') || ' ' || coalesce(${alias}.city, '') || ' ' ||
          coalesce(${alias}.state_code, '') || ' ' || coalesce(${alias}.postal_code, '') || ' ' ||
          coalesce(${alias}.country_code, '') || ' ' || coalesce(${alias}.phone, '')`;
}

function orderAddressSearchDocumentSql(alias: string) {
  return `coalesce(${alias}.shipping_address_snapshot->>'recipientName', '') || ' ' ||
          coalesce(${alias}.shipping_address_snapshot->>'line1', '') || ' ' ||
          coalesce(${alias}.shipping_address_snapshot->>'line2', '') || ' ' ||
          coalesce(${alias}.shipping_address_snapshot->>'city', '') || ' ' ||
          coalesce(${alias}.shipping_address_snapshot->>'stateCode', '') || ' ' ||
          coalesce(${alias}.shipping_address_snapshot->>'postalCode', '') || ' ' ||
          coalesce(${alias}.shipping_address_snapshot->>'countryCode', '')`;
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
  created_at: Date;
  updated_at: Date;
  tags: string[];
  total_count: number;
}
interface CustomerMetricsRow {
  total_customers: number;
  repeat_customer_rate: number;
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
  returned_order_count: number;
  credit_balance: number;
  store_credit_balance_cents: number;
  store_credit_currency: 'USD';
  store_credit_transaction_count: number;
  last_order_at: Date | null;
  saved_design_count: number;
  last_design_at: Date | null;
  email_marketing_status: MarketingStatus;
  sms_marketing_status: MarketingStatus;
  preferred_locale: CustomerLocale;
  preferred_locale_source: CustomerLocaleSource;
}
interface StoreCreditLedgerSummaryRow {
  balance_cents: number;
  currency: 'USD';
  total_count: number;
}
interface StoreCreditLedgerRow {
  id: string;
  entry_type: StoreCreditDirection;
  amount_cents: number;
  balance_after_cents: number;
  reason: StoreCreditReason;
  note: string | null;
  actor_label: string;
  created_at: Date;
}
interface CustomerOrderRow {
  order_number: string;
  status: string;
  payment_status: string;
  item_count: number;
  total_cents: number;
  created_at: Date;
  items: Array<{
    productName: string;
    color: string;
    size: string;
    quantity: number;
    unitPriceCents: number;
    imageUrl: string | null;
  }>;
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
interface CustomerTimelinePageRow {
  total_count: number;
  entries: Array<{
    id: string;
    eventType: string;
    body: string | null;
    metadata: Record<string, unknown>;
    actorLabel: string | null;
    createdAt: Date | string;
  }>;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
  const unique = new Map<string, string>();
  for (const value of values) {
    const tag = normalizeTag(value);
    const key = tag.toLocaleLowerCase('en-US');
    if (!unique.has(key)) unique.set(key, tag);
  }
  const tags = [...unique.values()];
  if (tags.length > 20) throw new CustomerOperationsValidationError('Use up to 20 customer tags.');
  return tags;
}
function normalizeCustomerIds(values: string[], maximum: number) {
  const ids = [...new Set(values.map(requireCustomerId))];
  if (!ids.length || ids.length > maximum)
    throw new CustomerOperationsValidationError(
      `Choose between 1 and ${maximum.toLocaleString('en-US')} customers.`,
    );
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
function requireAddressId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new CustomerOperationsValidationError('Customer address not found.');
  return value;
}
function customerSortSql(sort: CustomerSort) {
  const tieBreak = ',cp.last_seen_at DESC,cp.id ASC';
  if (sort === 'NAME_ASC') return `lower(display.customer_name) ASC NULLS LAST${tieBreak}`;
  if (sort === 'NAME_DESC') return `lower(display.customer_name) DESC NULLS LAST${tieBreak}`;
  if (sort === 'EMAIL_ASC') return `cp.normalized_email ASC${tieBreak}`;
  if (sort === 'EMAIL_DESC') return `cp.normalized_email DESC${tieBreak}`;
  if (sort === 'EMAIL_MARKETING_ASC') return `cp.email_marketing_status ASC${tieBreak}`;
  if (sort === 'EMAIL_MARKETING_DESC') return `cp.email_marketing_status DESC${tieBreak}`;
  if (sort === 'LOCATION_ASC')
    return `lower(coalesce(customer_address.location, saved_address.location, order_address.location)) ASC NULLS LAST${tieBreak}`;
  if (sort === 'LOCATION_DESC')
    return `lower(coalesce(customer_address.location, saved_address.location, order_address.location)) DESC NULLS LAST${tieBreak}`;
  if (sort === 'ORDER_COUNT_ASC') return `coalesce(order_summary.order_count, 0) ASC${tieBreak}`;
  if (sort === 'ORDER_COUNT_DESC') return `coalesce(order_summary.order_count, 0) DESC${tieBreak}`;
  if (sort === 'TOTAL_SPENT_ASC')
    return `coalesce(order_summary.total_spent_cents, 0) ASC${tieBreak}`;
  if (sort === 'TOTAL_SPENT_DESC')
    return `coalesce(order_summary.total_spent_cents, 0) DESC${tieBreak}`;
  if (sort === 'LAST_ORDER_ASC') return `order_summary.last_order_at ASC NULLS LAST${tieBreak}`;
  if (sort === 'LAST_ORDER_DESC') return `order_summary.last_order_at DESC NULLS LAST${tieBreak}`;
  if (sort === 'TAGS_ASC')
    return `lower(nullif(array_to_string(tags.values, ','), '')) ASC NULLS LAST${tieBreak}`;
  if (sort === 'TAGS_DESC')
    return `lower(nullif(array_to_string(tags.values, ','), '')) DESC NULLS LAST${tieBreak}`;
  if (sort === 'CUSTOMER_ADDED_ASC') return `cp.created_at ASC NULLS LAST${tieBreak}`;
  if (sort === 'CUSTOMER_ADDED_DESC') return `cp.created_at DESC NULLS LAST${tieBreak}`;
  if (sort === 'CUSTOMER_UPDATED_ASC') return `cp.updated_at ASC NULLS LAST${tieBreak}`;
  if (sort === 'CUSTOMER_UPDATED_DESC') return `cp.updated_at DESC NULLS LAST${tieBreak}`;
  return 'cp.last_seen_at DESC,cp.id DESC';
}
