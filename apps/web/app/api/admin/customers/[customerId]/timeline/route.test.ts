import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerOperationsValidationError, StaffAuthenticationError } from '@let-it-be/domain';

const { customerOperationsRuntime, listCustomerTimeline, requireAdminSession } = vi.hoisted(() => ({
  customerOperationsRuntime: vi.fn(),
  listCustomerTimeline: vi.fn(),
  requireAdminSession: vi.fn(),
}));

vi.mock('../../../../../../lib/platform', () => ({
  customerOperationsRuntime,
  requireAdminSession,
}));

import { GET } from './route';

const customerId = '3c127006-3b01-4846-af60-a9fcfaf86d57';
const actor = {
  id: '0aa23cc6-5224-42d6-8c14-a05775f82c00',
  staffMemberId: '58f8dd03-6925-431a-8674-8efab810c7dd',
  email: 'readonly@example.com',
  role: 'READ_ONLY' as const,
  expiresAt: new Date('2026-09-13T00:00:00.000Z'),
};

function context() {
  return { params: Promise.resolve({ customerId }) };
}

describe('GET /api/admin/customers/[customerId]/timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue(actor);
    listCustomerTimeline.mockResolvedValue({ entries: [], total: 24, page: 2, limit: 10 });
    customerOperationsRuntime.mockReturnValue({ listCustomerTimeline });
  });

  it('allows read-only staff to load a specific activity page', async () => {
    const response = await GET(
      new Request(`http://localhost/api/admin/customers/${customerId}/timeline?page=2&limit=10`),
      context(),
    );

    expect(response.status).toBe(200);
    expect(listCustomerTimeline).toHaveBeenCalledWith(actor, customerId, { page: 2, limit: 10 });
    await expect(response.json()).resolves.toEqual({
      timeline: { entries: [], total: 24, page: 2, limit: 10 },
    });
  });

  it('maps invalid pagination and missing authentication to API errors', async () => {
    listCustomerTimeline.mockRejectedValueOnce(
      new CustomerOperationsValidationError('Enter a valid page.'),
    );
    const invalid = await GET(
      new Request(`http://localhost/api/admin/customers/${customerId}/timeline?page=0`),
      context(),
    );
    expect(invalid.status).toBe(400);

    requireAdminSession.mockRejectedValueOnce(
      new StaffAuthenticationError('Admin authentication is required.'),
    );
    const unauthenticated = await GET(
      new Request(`http://localhost/api/admin/customers/${customerId}/timeline`),
      context(),
    );
    expect(unauthenticated.status).toBe(401);
  });
});
