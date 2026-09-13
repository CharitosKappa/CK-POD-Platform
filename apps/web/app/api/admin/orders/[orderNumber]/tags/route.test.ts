import { beforeEach, describe, expect, it, vi } from 'vitest';

const { orderDetailRuntime, replaceOrderTags, requireAdminSession } = vi.hoisted(() => ({
  orderDetailRuntime: vi.fn(),
  replaceOrderTags: vi.fn(),
  requireAdminSession: vi.fn(),
}));

vi.mock('../../../../../../lib/platform', () => ({ orderDetailRuntime, requireAdminSession }));

import { PUT } from './route';

const actor = { staffMemberId: 'staff-1', role: 'OPERATIONS', email: 'ops@example.test' };

describe('PUT order tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue(actor);
    orderDetailRuntime.mockReturnValue({ replaceOrderTags });
    replaceOrderTags.mockResolvedValue(['Priority']);
  });

  it('replaces persisted order tags', async () => {
    const response = await PUT(
      new Request('http://localhost', {
        method: 'PUT',
        body: JSON.stringify({ tags: ['Priority'] }),
      }),
      { params: Promise.resolve({ orderNumber: '#1001' }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tags: ['Priority'] });
  });

  it('rejects invalid tag values', async () => {
    const response = await PUT(
      new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ tags: [42] }) }),
      { params: Promise.resolve({ orderNumber: '#1001' }) },
    );
    expect(response.status).toBe(400);
  });
});
