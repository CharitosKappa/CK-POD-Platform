import { beforeEach, describe, expect, it, vi } from 'vitest';

const { customerOperationsRuntime, listCustomers, requireAdminSession } = vi.hoisted(() => ({
  customerOperationsRuntime: vi.fn(),
  listCustomers: vi.fn(),
  requireAdminSession: vi.fn(),
}));

vi.mock('../../../../lib/platform', () => ({
  customerOperationsRuntime,
  requireAdminSession,
}));

import { GET } from './route';

describe('GET /api/admin/customers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerOperationsRuntime.mockReturnValue({ listCustomers });
  });

  it('returns a client error for malformed integer filters without querying customers', async () => {
    const response = await GET(new Request('http://localhost/api/admin/customers?page=nope'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid page.' });
    expect(listCustomers).not.toHaveBeenCalled();
  });
});
