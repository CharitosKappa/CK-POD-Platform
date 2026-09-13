import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adminCommerceRuntime, listOrders, requireAdminSession } = vi.hoisted(() => ({
  adminCommerceRuntime: vi.fn(),
  listOrders: vi.fn(),
  requireAdminSession: vi.fn(),
}));

vi.mock('../../../../lib/platform', () => ({ adminCommerceRuntime, requireAdminSession }));

import { GET } from './route';

describe('GET /api/admin/orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue({ staffMemberId: 'staff-1', role: 'OPERATIONS' });
    adminCommerceRuntime.mockReturnValue({ listOrders });
    listOrders.mockResolvedValue({ orders: [], total: 0, page: 1, limit: 30 });
  });

  it.each([
    ['page=nope', 'Invalid page.'],
    ['limit=3.5', 'Invalid limit.'],
    ['sort=BROKEN', 'Unsupported order sort.'],
    ['payment=BROKEN', 'Unsupported payment status.'],
    ['printing=BROKEN', 'Unsupported printing status.'],
    ['fulfillment=BROKEN', 'Unsupported fulfillment status.'],
    ['from=09%2F01%2F2026', 'Enter a valid start date.'],
    ['from=2026-02-31', 'Enter a valid start date.'],
    ['minTotal=-1', 'Enter a valid minimum total.'],
    ['minTotal=50&maxTotal=20', 'Minimum total cannot exceed maximum total.'],
  ])('rejects malformed parameters: %s', async (query, message) => {
    const response = await GET(new Request(`http://localhost/api/admin/orders?${query}`));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(listOrders).not.toHaveBeenCalled();
  });

  it('passes validated filters and converts dollar inputs to cents', async () => {
    const response = await GET(
      new Request(
        'http://localhost/api/admin/orders?view=IN_PROGRESS&sort=TOTAL_DESC&payment=SUCCEEDED&printing=PRINTED&fulfillment=FULFILLED&from=2026-09-01&to=2026-09-13&minTotal=20.25&maxTotal=80',
      ),
    );

    expect(response.status).toBe(200);
    expect(listOrders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        view: 'IN_PROGRESS',
        sort: 'TOTAL_DESC',
        paymentStatus: 'SUCCEEDED',
        printingStatus: 'PRINTED',
        fulfillmentStatus: 'FULFILLED',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-13',
        minTotalCents: 2025,
        maxTotalCents: 8000,
      }),
    );
  });
});
