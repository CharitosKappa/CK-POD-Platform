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
