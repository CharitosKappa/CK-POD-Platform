import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addOrderNote, orderDetailRuntime, requireAdminSession } = vi.hoisted(() => ({
  addOrderNote: vi.fn(),
  orderDetailRuntime: vi.fn(),
  requireAdminSession: vi.fn(),
}));

vi.mock('../../../../../../lib/platform', () => ({ orderDetailRuntime, requireAdminSession }));

import { POST } from './route';

const actor = { staffMemberId: 'staff-1', role: 'OPERATIONS', email: 'ops@example.test' };

describe('POST order note', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue(actor);
    orderDetailRuntime.mockReturnValue({ addOrderNote });
    addOrderNote.mockResolvedValue({ id: 'note-1', body: 'Follow up' });
  });

  it('adds a persisted note', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ body: 'Follow up' }),
      }),
      { params: Promise.resolve({ orderNumber: '#1001' }) },
    );
    expect(response.status).toBe(201);
    expect(addOrderNote).toHaveBeenCalledWith(actor, '#1001', 'Follow up');
  });

  it('rejects a non-string body', async () => {
    const response = await POST(
      new Request('http://localhost', { method: 'POST', body: JSON.stringify({ body: 42 }) }),
      { params: Promise.resolve({ orderNumber: '#1001' }) },
    );
    expect(response.status).toBe(400);
  });
});
