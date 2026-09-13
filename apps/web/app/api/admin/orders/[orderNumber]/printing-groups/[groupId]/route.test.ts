import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPrintingGroup, orderDetailRuntime, requireAdminSession } = vi.hoisted(() => ({
  getPrintingGroup: vi.fn(),
  orderDetailRuntime: vi.fn(),
  requireAdminSession: vi.fn(),
}));

vi.mock('../../../../../../../lib/platform', () => ({ orderDetailRuntime, requireAdminSession }));

import { GET } from './route';

const actor = { staffMemberId: 'staff-1', role: 'OPERATIONS', email: 'ops@example.test' };

describe('GET order printing group', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue(actor);
    orderDetailRuntime.mockReturnValue({ getPrintingGroup });
  });

  it('enforces order and group ownership through the service boundary', async () => {
    const group = { id: 'group-1', orderNumber: '#1001', printingState: 'IN_PRODUCTION' };
    getPrintingGroup.mockResolvedValue(group);
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ orderNumber: '#1001', groupId: 'group-1' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ group });
    expect(getPrintingGroup).toHaveBeenCalledWith(actor, '#1001', 'group-1');
  });

  it('returns 404 for a mismatched group', async () => {
    getPrintingGroup.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ orderNumber: '#1001', groupId: 'other-group' }),
    });
    expect(response.status).toBe(404);
  });
});
