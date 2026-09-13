import { describe, expect, it, vi } from 'vitest';

import type { SqlPool } from '@let-it-be/db';

import { CustomerOperationsService, recordCustomerTouchpoint } from './customer-operations';

const actor = {
  staffMemberId: '00000000-0000-4000-8000-000000000001',
  role: 'OPERATIONS' as const,
  email: 'operations@example.test',
};

function customerIds(count: number) {
  return Array.from(
    { length: count },
    (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
}

describe('customer bulk selection', () => {
  it('exports selections larger than one customer page', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await expect(service.exportCustomers(actor, customerIds(264))).resolves.toContain('Name,Email');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps a bounded maximum for admin bulk operations', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await expect(service.exportCustomers(actor, customerIds(10_001))).rejects.toThrow(
      'Choose between 1 and 10,000 customers.',
    );
    expect(query).not.toHaveBeenCalled();
  });
});

describe('customer lifecycle views', () => {
  it('uses set-based order summaries and indexable customer search predicates', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT cp.id,')) return { rows: [] };
      return {
        rows: [
          {
            total_customers: 0,
            repeat_customer_rate: 0,
            average_lifetime_spend_cents: 0,
            email_subscribers: 0,
          },
        ],
      };
    });
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await service.listCustomers(actor, { query: 'miami' });

    const directorySql = String(
      query.mock.calls.find(([sql]) => String(sql).includes('SELECT cp.id,'))?.[0],
    );
    const metricsSql = String(
      query.mock.calls.find(([sql]) => String(sql).includes('SELECT count(*)::int'))?.[0],
    );
    expect(directorySql).toContain('WITH refunded_orders AS');
    expect(directorySql).toContain('LEFT JOIN order_summaries order_summary');
    expect(directorySql).toContain('FROM app.customer_addresses search_address');
    expect(directorySql).not.toContain('LEFT JOIN LATERAL (SELECT count(*)::int AS order_count');
    expect(metricsSql).toContain('WITH refunded_orders AS');
    expect(metricsSql).toContain('LEFT JOIN order_summaries summary');
  });

  it.each([
    ['RECENTLY_ADDED', "cp.first_seen_at >= now() - interval '30 days'"],
    ['PROSPECTS', 'coalesce(order_summary.order_count, 0) = 0'],
    ['FIRST_TIME', 'coalesce(order_summary.order_count, 0) = 1'],
    ['RETURNING', 'coalesce(order_summary.order_count, 0) >= 2'],
  ] as const)('applies the %s segment predicate', async (view, predicate) => {
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      if (sql.includes('SELECT cp.id,')) return { rows: [] };
      if (sql.includes('SELECT count(*)::int AS total_customers'))
        return {
          rows: [
            {
              total_customers: 0,
              repeat_customer_rate: 0,
              average_lifetime_spend_cents: 0,
              email_subscribers: 0,
            },
          ],
        };
      return { rows: [] };
    });
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await service.listCustomers(actor, { view });

    const directorySql = query.mock.calls.find(([sql]) => String(sql).includes('SELECT cp.id,'));
    expect(directorySql?.[0]).toContain(predicate);
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO app.customer_profiles')),
    ).toBe(false);
  });
});

describe('customer tag catalog', () => {
  it('returns the complete customer tag list in case-insensitive alphabetical order', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ value: 'Big Spender' }, { value: 'newsletter' }, { value: 'VIP' }],
    });
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await expect(service.listTags(actor)).resolves.toEqual(['Big Spender', 'newsletter', 'VIP']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY lower(value), value'));
  });
});

describe('customer preferred language', () => {
  it('records browser language without allowing it to overwrite an explicit preference', async () => {
    const customerProfileId = '00000000-0000-4000-8000-000000000077';
    const query = vi.fn().mockResolvedValue({ rows: [{ id: customerProfileId }] });

    await expect(
      recordCustomerTouchpoint({ query } as never, {
        email: ' Maria@Example.test ',
        source: 'CHECKOUT',
        preferredLocale: 'en',
      }),
    ).resolves.toBe(customerProfileId);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("preferred_locale_source IN ('ADMIN', 'CUSTOMER')"),
      ['maria@example.test', null, 'CHECKOUT', 'en', 'BROWSER'],
    );
    expect(query.mock.calls[0]?.[0]).toContain('RETURNING id');
  });
});

describe('customer detail commerce summary', () => {
  it('maps refunded-order rate and latest-order item details', async () => {
    const createdAt = new Date('2026-09-11T18:57:00Z');
    const customerId = '00000000-0000-4000-8000-000000000099';
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      if (sql.includes('WHERE cp.id = $1'))
        return {
          rows: [
            {
              id: customerId,
              email: 'ari@example.test',
              user_id: '00000000-0000-4000-8000-000000000098',
              first_seen_source: 'ORDER',
              first_seen_at: new Date('2026-03-11T18:57:00Z'),
              last_seen_at: createdAt,
              first_name: 'Ari',
              last_name: 'Tsoukala',
              phone: null,
              name: 'Ari Tsoukala',
              order_count: 4,
              total_spent_cents: 16_000,
              returned_order_count: 1,
              credit_balance: 2,
              store_credit_balance_cents: 2599,
              store_credit_currency: 'USD',
              store_credit_transaction_count: 2,
              last_order_at: createdAt,
              saved_design_count: 1,
              last_design_at: createdAt,
              email_marketing_status: 'SUBSCRIBED',
              sms_marketing_status: 'NOT_SUBSCRIBED',
              preferred_locale: 'en',
              preferred_locale_source: 'BROWSER',
            },
          ],
        };
      if (sql.includes('SELECT o.order_number'))
        return {
          rows: [
            {
              order_number: '#15156',
              status: 'DELIVERED',
              payment_status: 'SUCCEEDED',
              item_count: 2,
              total_cents: 7998,
              created_at: createdAt,
              items: [
                {
                  productName: 'Classic T-Shirt',
                  color: 'Black',
                  size: 'L',
                  quantity: 2,
                  unitPriceCents: 3999,
                  imageUrl: '/images/black-shirt.png',
                },
              ],
            },
          ],
        };
      if (sql.includes('WITH timeline AS'))
        return {
          rows: [
            {
              total_count: 3,
              entries: [
                {
                  id: 'order-state:event-2',
                  eventType: 'ORDER_STATUS_CHANGED',
                  body: 'Carrier confirmed delivery',
                  metadata: {
                    orderNumber: '#15156',
                    fromState: 'SHIPPED',
                    toState: 'DELIVERED',
                  },
                  actorLabel: 'System',
                  createdAt,
                },
                {
                  id: 'generation:event-3',
                  eventType: 'DESIGN_GENERATION',
                  body: 'A vintage astronaut illustration',
                  metadata: { status: 'SUCCEEDED', creditStatus: 'CONSUMED' },
                  actorLabel: 'Customer',
                  createdAt: new Date('2026-09-11T18:56:00Z'),
                },
                {
                  id: 'customer:event-1',
                  eventType: 'PROFILE_UPDATED',
                  body: null,
                  metadata: { changedFields: ['phone'] },
                  actorLabel: 'operations@example.test',
                  createdAt: new Date('2026-09-11T18:55:00Z'),
                },
              ],
            },
          ],
        };
      if (sql.includes('SELECT body FROM (')) return { rows: [{ body: 'Priority customer' }] };
      return { rows: [] };
    });
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await expect(service.getCustomer(actor, customerId)).resolves.toMatchObject({
      refundedOrderRate: 25,
      creditBalance: 2,
      storeCreditBalanceCents: 2599,
      storeCreditCurrency: 'USD',
      storeCreditTransactionCount: 2,
      preferredLocale: 'en',
      preferredLocaleSource: 'BROWSER',
      latestNote: 'Priority customer',
      timelineTotal: 3,
      orders: [
        {
          paymentStatus: 'SUCCEEDED',
          itemCount: 2,
          items: [
            {
              productName: 'Classic T-Shirt',
              color: 'Black',
              size: 'L',
              quantity: 2,
              unitPriceCents: 3999,
            },
          ],
        },
      ],
      timeline: [
        {
          eventType: 'ORDER_STATUS_CHANGED',
          actorLabel: 'System',
        },
        {
          eventType: 'DESIGN_GENERATION',
          actorLabel: 'Customer',
        },
        {
          eventType: 'PROFILE_UPDATED',
          actorLabel: 'operations@example.test',
        },
      ],
    });

    const identitySql = query.mock.calls.find(([sql]) => String(sql).includes('WHERE cp.id = $1'));
    expect(identitySql?.[0]).toContain('order_summary.returned_order_count');
    expect(identitySql?.[0]).toContain("refund.status='SUCCEEDED'");
    expect(identitySql?.[0]).toContain('succeeded_refund.refunded_cents');
    expect(identitySql?.[0]).toContain('greatest(');
    expect(identitySql?.[0]).toContain('LEFT JOIN app.store_credit_accounts store_credit');
    expect(identitySql?.[0]).toContain('coalesce(store_credit.current_balance_cents, 0)::int');
    expect(identitySql?.[0]).toContain('store_credit_transaction_count');
    expect(identitySql?.[0]).toContain('orders.customer_profile_id=cp.id');
    const ordersSql = query.mock.calls.find(([sql]) =>
      String(sql).includes('SELECT o.order_number'),
    );
    expect(ordersSql?.[0]).toContain('o.customer_profile_id = $1');
    expect(ordersSql?.[0]).toContain('o.customer_profile_id IS NULL');
  });
});

describe('customer Store Credit ledger', () => {
  it('returns a deterministic paginated transaction history with authoritative balances', async () => {
    const customerId = '00000000-0000-4000-8000-000000000099';
    const createdAt = new Date('2026-09-12T14:30:00Z');
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      if (sql.includes('count(ledger.id)'))
        return {
          rows: [{ balance_cents: 0, currency: 'USD', total_count: 2 }],
        };
      if (sql.includes('FROM app.store_credit_ledger ledger'))
        return {
          rows: [
            {
              id: '00000000-0000-4000-8000-000000000120',
              entry_type: 'DEBIT',
              amount_cents: -2500,
              balance_after_cents: 0,
              reason: 'REFUND',
              note: 'Applied to replacement order',
              actor_label: 'operations@example.test',
              created_at: createdAt,
            },
          ],
        };
      return { rows: [] };
    });
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await expect(
      service.listStoreCreditLedger(actor, customerId, { page: 2, limit: 20 }),
    ).resolves.toEqual({
      balanceCents: 0,
      currency: 'USD',
      total: 2,
      page: 2,
      limit: 20,
      entries: [
        {
          id: '00000000-0000-4000-8000-000000000120',
          entryType: 'DEBIT',
          amountCents: 2500,
          balanceAfterCents: 0,
          reason: 'REFUND',
          note: 'Applied to replacement order',
          actorLabel: 'operations@example.test',
          createdAt,
        },
      ],
    });

    const entryQuery = query.mock.calls.find(([sql]) =>
      String(sql).includes('FROM app.store_credit_ledger ledger'),
    );
    expect(entryQuery?.[0]).toContain('ORDER BY ledger.created_at DESC, ledger.id DESC');
    expect(entryQuery?.[1]).toEqual([customerId, 20, 20]);
  });

  it('rejects invalid pagination before querying customer Store Credit data', async () => {
    const query = vi.fn();
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await expect(
      service.listStoreCreditLedger(actor, '00000000-0000-4000-8000-000000000099', {
        page: 0,
      }),
    ).rejects.toThrow('Enter a valid page.');
    expect(query).not.toHaveBeenCalled();
  });
});

describe('customer timeline pagination', () => {
  it('orders and paginates the combined activity stream in PostgreSQL', async () => {
    const customerId = '00000000-0000-4000-8000-000000000099';
    const createdAt = new Date('2026-09-12T14:30:00Z');
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      if (sql.includes('SELECT normalized_email AS email'))
        return {
          rows: [
            {
              email: 'ari@example.test',
              user_id: '00000000-0000-4000-8000-000000000098',
            },
          ],
        };
      if (sql.includes('WITH timeline AS'))
        return {
          rows: [
            {
              total_count: 24,
              entries: [
                {
                  id: 'customer:event-11',
                  eventType: 'PROFILE_UPDATED',
                  body: null,
                  metadata: { changedFields: ['phone'] },
                  actorLabel: 'operations@example.test',
                  createdAt,
                },
              ],
            },
          ],
        };
      return { rows: [] };
    });
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await expect(
      service.listCustomerTimeline(actor, customerId, { page: 2, limit: 10 }),
    ).resolves.toEqual({
      entries: [
        {
          id: 'customer:event-11',
          eventType: 'PROFILE_UPDATED',
          body: null,
          metadata: { changedFields: ['phone'] },
          actorLabel: 'operations@example.test',
          createdAt,
        },
      ],
      total: 24,
      page: 2,
      limit: 10,
    });

    const timelineQuery = query.mock.calls.find(([sql]) =>
      String(sql).includes('WITH timeline AS'),
    );
    expect(timelineQuery?.[0]).toContain('LIMIT $4 OFFSET $5');
    expect(timelineQuery?.[0]).toContain('orders.customer_profile_id=$1');
    expect(timelineQuery?.[1]).toEqual([
      customerId,
      'ari@example.test',
      '00000000-0000-4000-8000-000000000098',
      10,
      10,
    ]);
  });
});

describe('customer profile data integrity', () => {
  it('does not change consent when a partial profile update omits marketing fields', async () => {
    const customerId = '00000000-0000-4000-8000-000000000099';
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      if (sql.includes('SELECT profile.id'))
        return {
          rows: [
            {
              id: customerId,
              user_id: null,
              normalized_email: 'ari@example.test',
              first_name: 'Ari',
              last_name: 'Tsoukala',
              phone: null,
              email_marketing_status: 'SUBSCRIBED',
              sms_marketing_status: 'UNSUBSCRIBED',
              preferred_locale: 'en',
              address_recipient_name: null,
              address_phone: null,
              line1: null,
              line2: null,
              city: null,
              state_code: null,
              postal_code: null,
              country_code: null,
            },
          ],
        };
      if (sql.includes('SELECT id FROM app.customer_profiles')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const pool = { query, connect: vi.fn().mockResolvedValue(client) } as unknown as SqlPool;
    const service = new CustomerOperationsService(pool);

    await service.updateCustomer(actor, customerId, {
      email: 'ari@example.test',
      firstName: 'Ari',
      lastName: 'Tsoukala',
    });

    const profileUpdate = query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE app.customer_profiles'),
    );
    expect(profileUpdate?.[1]?.[5]).toBe('SUBSCRIBED');
    expect(profileUpdate?.[1]?.[6]).toBe('UNSUBSCRIBED');
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("VALUES ($1,'CONSENT_UPDATED'")),
    ).toBe(false);
  });

  it('records an explicit withdrawal as unsubscribed without changing an untouched channel', async () => {
    const customerId = '00000000-0000-4000-8000-000000000099';
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      if (sql.includes('SELECT profile.id'))
        return {
          rows: [
            {
              id: customerId,
              user_id: null,
              normalized_email: 'ari@example.test',
              first_name: 'Ari',
              last_name: 'Tsoukala',
              phone: null,
              email_marketing_status: 'SUBSCRIBED',
              sms_marketing_status: 'NOT_SUBSCRIBED',
              preferred_locale: 'en',
              address_recipient_name: null,
              address_phone: null,
              line1: null,
              line2: null,
              city: null,
              state_code: null,
              postal_code: null,
              country_code: null,
            },
          ],
        };
      if (sql.includes('SELECT id FROM app.customer_profiles')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const pool = { query, connect: vi.fn().mockResolvedValue(client) } as unknown as SqlPool;
    const service = new CustomerOperationsService(pool);

    await service.updateCustomer(actor, customerId, {
      email: 'ari@example.test',
      firstName: 'Ari',
      lastName: 'Tsoukala',
      emailMarketingStatus: 'NOT_SUBSCRIBED',
      smsMarketingStatus: 'NOT_SUBSCRIBED',
    });

    const profileUpdate = query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE app.customer_profiles'),
    );
    expect(profileUpdate?.[1]?.[5]).toBe('UNSUBSCRIBED');
    expect(profileUpdate?.[1]?.[6]).toBe('NOT_SUBSCRIBED');

    const consentWrite = query.mock.calls.find(([sql]) =>
      String(sql).includes("VALUES ($1,'CONSENT_UPDATED'"),
    );
    expect(JSON.parse(String(consentWrite?.[1]?.[1]))).toEqual({
      email: { previousStatus: 'SUBSCRIBED', newStatus: 'UNSUBSCRIBED' },
      source: 'ADMIN',
    });
  });

  it('updates the default address without deleting a second saved address', async () => {
    const customerId = '00000000-0000-4000-8000-000000000099';
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      if (sql.includes('SELECT profile.id'))
        return {
          rows: [
            {
              id: customerId,
              user_id: null,
              normalized_email: 'ari@example.test',
              first_name: 'Ari',
              last_name: 'Tsoukala',
              phone: null,
              email_marketing_status: 'NOT_SUBSCRIBED',
              sms_marketing_status: 'NOT_SUBSCRIBED',
              preferred_locale: 'en',
              line1: '1 Old Street',
              line2: null,
              city: 'Miami',
              state_code: 'FL',
              postal_code: '33101',
              country_code: 'US',
            },
          ],
        };
      if (sql.includes('SELECT id FROM app.customer_profiles')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const pool = { query, connect: vi.fn().mockResolvedValue(client) } as unknown as SqlPool;
    const service = new CustomerOperationsService(pool);

    await service.updateCustomer(actor, customerId, {
      email: 'ari@example.test',
      firstName: 'Ari',
      lastName: 'Tsoukala',
      emailMarketingStatus: 'NOT_SUBSCRIBED',
      smsMarketingStatus: 'NOT_SUBSCRIBED',
      address: {
        recipientName: 'Ari Tsoukala',
        phone: '+1 305 555 0101',
        line1: '2 New Street',
        city: 'Miami',
        stateCode: 'FL',
        postalCode: '33101',
        countryCode: 'US',
      },
    });

    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM app.customer_addresses')),
    ).toBe(false);
    const addressWrite = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO app.customer_addresses'),
    );
    expect(addressWrite?.[0]).toContain('ON CONFLICT');
    expect(addressWrite?.[1]).toContain('Ari Tsoukala');
    expect(addressWrite?.[1]).toContain('+1 305 555 0101');
  });

  it('deduplicates customer tags case-insensitively', async () => {
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      if (sql.includes('SELECT id FROM app.customer_profiles'))
        return { rows: [{ id: '00000000-0000-4000-8000-000000000099' }] };
      if (sql.includes('RETURNING id'))
        return { rows: [{ id: '00000000-0000-4000-8000-000000000088' }] };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const pool = { query, connect: vi.fn().mockResolvedValue(client) } as unknown as SqlPool;
    const service = new CustomerOperationsService(pool);

    await expect(
      service.replaceTags(actor, '00000000-0000-4000-8000-000000000099', ['VIP', 'vip']),
    ).resolves.toEqual(['VIP']);
    const tagInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO app.customer_tags'),
    );
    expect(tagInsert?.[0]).toContain('lower(value)=lower($1)');
  });
});

describe('customer address book mutations', () => {
  const customerId = '00000000-0000-4000-8000-000000000099';
  const addressId = '00000000-0000-4000-8000-000000000077';
  const replacementId = '00000000-0000-4000-8000-000000000066';
  const address = {
    recipientName: 'Ari Tsoukala',
    phone: '+1 305 555 0101',
    line1: '2 New Street',
    city: 'Miami',
    stateCode: 'FL',
    postalCode: '33101',
    countryCode: 'US',
  };

  it('creates the first profile address as default and records the address event', async () => {
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      if (sql.includes('SELECT id FROM app.customer_profiles'))
        return { rows: [{ id: customerId }] };
      if (sql.includes('SELECT count(*)::int AS address_count'))
        return { rows: [{ address_count: 0 }] };
      if (sql.includes('INSERT INTO app.customer_addresses')) return { rows: [{ id: addressId }] };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const service = new CustomerOperationsService({
      query,
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as SqlPool);

    await expect(service.createCustomerAddress(actor, customerId, address)).resolves.toBe(
      addressId,
    );

    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO app.customer_addresses'),
    );
    expect(insert?.[1]).toContain(true);
    expect(
      query.mock.calls.some(
        ([sql, parameters]) =>
          String(sql).includes('INSERT INTO app.customer_timeline_events') &&
          parameters?.[1] === 'ADDRESS_ADDED' &&
          String(parameters?.[2]).includes(addressId),
      ),
    ).toBe(true);
  });

  it('updates only an address owned by the customer and can make it the default', async () => {
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      if (sql.includes('SELECT id,is_default FROM app.customer_addresses'))
        return { rows: [{ id: addressId, is_default: false }] };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const service = new CustomerOperationsService({
      query,
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as SqlPool);

    await service.updateCustomerAddress(actor, customerId, addressId, {
      ...address,
      isDefault: true,
    });

    expect(
      query.mock.calls.some(
        ([sql, parameters]) =>
          String(sql).includes('SET is_default=false') && parameters?.[0] === customerId,
      ),
    ).toBe(true);
    expect(
      query.mock.calls.some(
        ([sql]) =>
          String(sql).includes('UPDATE app.customer_addresses') &&
          String(sql).includes('customer_profile_id=$2'),
      ),
    ).toBe(true);
  });

  it('promotes a remaining address when the default address is removed', async () => {
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      void parameters;
      if (sql.includes('DELETE FROM app.customer_addresses'))
        return { rows: [{ id: addressId, is_default: true }] };
      if (sql.includes('RETURNING id') && sql.includes('SET is_default=true'))
        return { rows: [{ id: replacementId }] };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const service = new CustomerOperationsService({
      query,
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as SqlPool);

    await service.deleteCustomerAddress(actor, customerId, addressId);

    expect(
      query.mock.calls.some(
        ([sql, parameters]) =>
          String(sql).includes('INSERT INTO app.customer_timeline_events') &&
          parameters?.[1] === 'ADDRESS_REMOVED' &&
          String(parameters?.[2]).includes(replacementId),
      ),
    ).toBe(true);
  });
});
