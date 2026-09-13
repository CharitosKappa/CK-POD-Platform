import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  customerOperationsRuntime,
  deleteCustomerAddress,
  requireAdminSession,
  updateCustomerAddress,
} = vi.hoisted(() => ({
  customerOperationsRuntime: vi.fn(),
  deleteCustomerAddress: vi.fn(),
  requireAdminSession: vi.fn(),
  updateCustomerAddress: vi.fn(),
}));

vi.mock('../../../../../../../lib/platform', () => ({
  customerOperationsRuntime,
  requireAdminSession,
}));

import { DELETE, PATCH } from './route';

const customerId = '3c127006-3b01-4846-af60-a9fcfaf86d57';
const addressId = '3c127006-3b01-4846-af60-a9fcfaf86d58';
const actor = { staffMemberId: 'staff-1', role: 'OPERATIONS', email: 'ops@example.test' };
const context = { params: Promise.resolve({ customerId, addressId }) };

describe('/api/admin/customers/[customerId]/addresses/[addressId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue(actor);
    customerOperationsRuntime.mockReturnValue({ updateCustomerAddress, deleteCustomerAddress });
  });

  it('updates the customer-scoped address', async () => {
    const body = {
      recipientName: 'Ari Tsoukala',
      line1: '2 Palm Avenue',
      city: 'Miami',
      postalCode: '33101',
      countryCode: 'US',
      isDefault: true,
    };
    const response = await PATCH(
      new Request('http://localhost/api/admin/customers/id/addresses/id', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(updateCustomerAddress).toHaveBeenCalledWith(actor, customerId, addressId, body);
  });

  it('deletes the customer-scoped address', async () => {
    const response = await DELETE(
      new Request('http://localhost/api/admin/customers/id/addresses/id', { method: 'DELETE' }),
      context,
    );

    expect(response.status).toBe(200);
    expect(deleteCustomerAddress).toHaveBeenCalledWith(actor, customerId, addressId);
  });
});
