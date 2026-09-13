import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listTimeline, orderDetailRuntime, requireAdminSession } = vi.hoisted(() => ({
  listTimeline: vi.fn(),
  orderDetailRuntime: vi.fn(),
  requireAdminSession: vi.fn(),
}));

vi.mock('../../../../../../lib/platform', () => ({ orderDetailRuntime, requireAdminSession }));

import { GET } from './route';

const actor = { staffMemberId: 'staff-1', role: 'OPERATIONS', email: 'ops@example.test' };

describe('GET order timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue(actor);
    orderDetailRuntime.mockReturnValue({ listTimeline });
    listTimeline.mockResolvedValue({ events: [], nextCursor: null });
  });

  it('passes a bounded limit and opaque cursor', async () => {
    const response = await GET(new Request('http://localhost?limit=10&cursor=opaque'), {
      params: Promise.resolve({ orderNumber: '#1001' }),
    });
    expect(response.status).toBe(200);
    expect(listTimeline).toHaveBeenCalledWith(actor, '#1001', { limit: 10, cursor: 'opaque' });
  });

  it('rejects an invalid limit at the route boundary', async () => {
    const response = await GET(new Request('http://localhost?limit=500'), {
      params: Promise.resolve({ orderNumber: '#1001' }),
    });
    expect(response.status).toBe(400);
    expect(listTimeline).not.toHaveBeenCalled();
  });
});
