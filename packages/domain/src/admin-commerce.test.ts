import { describe, expect, it, vi } from 'vitest';

import type { SqlPool } from '@let-it-be/db';

import { AdminCommerceService } from './admin-commerce';

const actor = {
  id: '00000000-0000-4000-8000-000000000002',
  staffMemberId: '00000000-0000-4000-8000-000000000001',
  role: 'OPERATIONS' as const,
  email: 'operations@example.test',
  expiresAt: new Date('2026-09-13T00:00:00.000Z'),
};

describe('admin order customer filtering', () => {
  it('rejects a malformed customer profile id before querying PostgreSQL', async () => {
    const query = vi.fn();
    const service = new AdminCommerceService({ query } as unknown as SqlPool);

    await expect(service.listOrders(actor, { customerId: 'not-a-uuid' })).rejects.toThrow(
      'Enter a valid customer id.',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('filters orders by the stable customer profile id', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new AdminCommerceService({ query } as unknown as SqlPool);
    const customerId = '00000000-0000-4000-8000-000000000099';

    await service.listOrders(actor, { customerId, page: 1, limit: 30 });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('orders.customer_profile_id = $1::uuid');
    expect(query.mock.calls[0]?.[1]).toEqual([customerId]);
    expect(query.mock.calls[1]?.[1]).toEqual([customerId, 30, 0]);
  });
});

describe('admin order directory queries', () => {
  it.each([
    [{ sort: 'BROKEN' }, 'Unsupported order sort.'],
    [{ paymentStatus: 'BROKEN' }, 'Unsupported payment status.'],
    [{ printingStatus: 'BROKEN' }, 'Unsupported printing status.'],
    [{ fulfillmentStatus: 'BROKEN' }, 'Unsupported fulfillment status.'],
    [{ dateFrom: '09/01/2026' }, 'Enter a valid start date.'],
    [{ dateFrom: '2026-02-31' }, 'Enter a valid start date.'],
    [{ minTotalCents: -1 }, 'Enter a valid minimum total.'],
    [{ minTotalCents: 5000, maxTotalCents: 2000 }, 'Minimum total cannot exceed maximum total.'],
  ])('rejects malformed filters before querying PostgreSQL', async (options, message) => {
    const query = vi.fn();
    const service = new AdminCommerceService({ query } as unknown as SqlPool);

    await expect(service.listOrders(actor, options as never)).rejects.toThrow(message);
    expect(query).not.toHaveBeenCalled();
  });

  it('combines layer filters and orders totals deterministically', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new AdminCommerceService({ query } as unknown as SqlPool);

    await service.listOrders(actor, {
      view: 'IN_PROGRESS',
      sort: 'TOTAL_DESC',
      paymentStatus: 'SUCCEEDED',
      printingStatus: 'PRINTED',
      fulfillmentStatus: 'FULFILLED',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-13',
      minTotalCents: 2000,
      maxTotalCents: 8000,
    } as never);

    const sql = String(query.mock.calls[1]?.[0]);
    const values = query.mock.calls[1]?.[1] as unknown[];
    expect(sql).toContain('printing_status');
    expect(sql).toContain('fulfillment_status');
    expect(sql).toContain('ORDER BY total_cents DESC');
    expect(values).toEqual(
      expect.arrayContaining(['SUCCEEDED', 'PRINTED', 'FULFILLED', 2000, 8000]),
    );
  });

  it('returns persisted identity, currency, printing, and fulfillment values for an order', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000010',
          order_number: '#10',
          status: 'IN_PRODUCTION',
          customer_email: 'taylor@example.test',
          customer_name: 'Taylor Example',
          total_cents: 4299,
          currency: 'USD',
          payment_status: 'SUCCEEDED',
          printing_status: 'IN_PRODUCTION',
          fulfillment_status: 'UNFULFILLED',
          shipping_address_snapshot: {},
          billing_address_snapshot: {},
          created_at: new Date('2026-09-13T12:00:00.000Z'),
          items: [{ productName: 'Classic T-Shirt', color: 'Black', size: 'XL', quantity: 1 }],
        },
      ],
    });
    const service = new AdminCommerceService({ query } as unknown as SqlPool);

    const result = await service.getOrder(actor, '#10');

    expect(result).toMatchObject({
      id: '00000000-0000-4000-8000-000000000010',
      currency: 'USD',
      printingStatus: 'IN_PRODUCTION',
      fulfillmentStatus: 'UNFULFILLED',
    });
    expect(String(query.mock.calls[0]?.[0])).toContain('admin_order_layers');
  });
});
