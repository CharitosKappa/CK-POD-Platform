import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOrder, orderDetailRuntime, requireAdminSession } = vi.hoisted(() => ({
  getOrder: vi.fn(),
  orderDetailRuntime: vi.fn(),
  requireAdminSession: vi.fn(),
}));

vi.mock('../../../../../lib/platform', () => ({ orderDetailRuntime, requireAdminSession }));

import { GET } from './route';

const actor = { staffMemberId: 'staff-1', role: 'OPERATIONS', email: 'ops@example.test' };

describe('GET /api/admin/orders/[orderNumber]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue(actor);
    orderDetailRuntime.mockReturnValue({ getOrder });
  });

  it('returns one explicit order-detail projection', async () => {
    const order = { orderNumber: '#1001', paymentState: 'PAID', groups: [] };
    getOrder.mockResolvedValue(order);
    const response = await GET(new Request('http://localhost/api/admin/orders/%231001'), {
      params: Promise.resolve({ orderNumber: '#1001' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ order });
    expect(getOrder).toHaveBeenCalledWith(actor, '#1001');
  });

  it('returns 404 for an unknown order', async () => {
    getOrder.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost/api/admin/orders/missing'), {
      params: Promise.resolve({ orderNumber: 'missing' }),
    });
    expect(response.status).toBe(404);
  });
});
