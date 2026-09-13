import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCustomerAddress, customerOperationsRuntime, requireAdminSession } = vi.hoisted(
  () => ({
    createCustomerAddress: vi.fn(),
    customerOperationsRuntime: vi.fn(),
    requireAdminSession: vi.fn(),
  }),
);

vi.mock('../../../../../../lib/platform', () => ({
  customerOperationsRuntime,
  requireAdminSession,
}));

import { POST } from './route';

const customerId = '3c127006-3b01-4846-af60-a9fcfaf86d57';
const addressId = '3c127006-3b01-4846-af60-a9fcfaf86d58';
const actor = { staffMemberId: 'staff-1', role: 'OPERATIONS', email: 'ops@example.test' };

describe('POST /api/admin/customers/[customerId]/addresses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue(actor);
    customerOperationsRuntime.mockReturnValue({ createCustomerAddress });
    createCustomerAddress.mockResolvedValue(addressId);
  });

  it('creates a customer-scoped address', async () => {
    const body = {
      recipientName: 'Ari Tsoukala',
      line1: '1 Palm Avenue',
      city: 'Miami',
      stateCode: 'FL',
      postalCode: '33101',
      countryCode: 'US',
      isDefault: true,
    };
    const response = await POST(
      new Request('http://localhost/api/admin/customers/id/addresses', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ customerId }) },
    );

    expect(response.status).toBe(201);
    expect(createCustomerAddress).toHaveBeenCalledWith(actor, customerId, body);
    await expect(response.json()).resolves.toEqual({ addressId });
  });
});
