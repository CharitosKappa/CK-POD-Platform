import { describe, expect, it, vi } from 'vitest';

import type { SqlPool } from '@let-it-be/db';

import { CustomerOperationsService } from './customer-operations';

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
  it.each([
    ['RECENTLY_ADDED', "cp.first_seen_at >= now() - interval '30 days'"],
    ['PROSPECTS', 'order_summary.order_count = 0'],
    ['FIRST_TIME', 'order_summary.order_count = 1'],
    ['RETURNING', 'order_summary.order_count >= 2'],
  ] as const)('applies the %s segment predicate', async (view, predicate) => {
    const query = vi.fn(async (sql: string) => {
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
  });
});

describe('customer detail commerce summary', () => {
  it('maps refunded-order rate and latest-order item details', async () => {
    const createdAt = new Date('2026-09-11T18:57:00Z');
    const customerId = '00000000-0000-4000-8000-000000000099';
    const query = vi.fn(async (sql: string) => {
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
              last_order_at: createdAt,
              saved_design_count: 1,
              last_design_at: createdAt,
              email_marketing_status: 'SUBSCRIBED',
              sms_marketing_status: 'UNKNOWN',
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
      if (sql.includes('FROM app.customer_timeline_events event'))
        return {
          rows: [
            {
              id: 'customer:event-1',
              event_type: 'PROFILE_UPDATED',
              body: null,
              metadata: { changedFields: ['phone'] },
              actor_label: 'operations@example.test',
              created_at: new Date('2026-09-11T18:55:00Z'),
            },
          ],
        };
      if (sql.includes("'ORDER_STATUS_CHANGED' AS event_type"))
        return {
          rows: [
            {
              id: 'order-state:event-2',
              event_type: 'ORDER_STATUS_CHANGED',
              body: 'Carrier confirmed delivery',
              metadata: {
                orderNumber: '#15156',
                fromState: 'SHIPPED',
                toState: 'DELIVERED',
              },
              actor_label: 'System',
              created_at: createdAt,
            },
          ],
        };
      if (sql.includes('FROM app.generations generation'))
        return {
          rows: [
            {
              id: 'generation:event-3',
              event_type: 'DESIGN_GENERATION',
              body: 'A vintage astronaut illustration',
              metadata: { status: 'SUCCEEDED', creditStatus: 'CONSUMED' },
              actor_label: 'Customer',
              created_at: new Date('2026-09-11T18:56:00Z'),
            },
          ],
        };
      return { rows: [] };
    });
    const service = new CustomerOperationsService({ query } as unknown as SqlPool);

    await expect(service.getCustomer(actor, customerId)).resolves.toMatchObject({
      returnRate: 25,
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
  });
});
