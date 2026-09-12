import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerOperationsValidationError, StaffAuthenticationError } from '@let-it-be/domain';

const { customerOperationsRuntime, listStoreCreditLedger, requireAdminSession } = vi.hoisted(
  () => ({
    customerOperationsRuntime: vi.fn(),
    listStoreCreditLedger: vi.fn(),
    requireAdminSession: vi.fn(),
  }),
);

vi.mock('../../../../../../lib/platform', () => ({
  customerOperationsRuntime,
  requireAdminSession,
}));

import { GET } from './route';

const customerId = '3c127006-3b01-4846-af60-a9fcfaf86d57';
const actor = {
  id: '0aa23cc6-5224-42d6-8c14-a05775f82c00',
  staffMemberId: '58f8dd03-6925-431a-8674-8efab810c7dd',
  email: 'owner@example.com',
  role: 'OWNER' as const,
  expiresAt: new Date('2026-09-13T00:00:00.000Z'),
};
const ledger = {
  balanceCents: 0,
  currency: 'USD' as const,
  total: 2,
  page: 2,
  limit: 20,
  entries: [],
};

function context() {
  return { params: Promise.resolve({ customerId }) };
}

describe('GET /api/admin/customers/[customerId]/store-credit-ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue(actor);
    listStoreCreditLedger.mockResolvedValue(ledger);
    customerOperationsRuntime.mockReturnValue({ listStoreCreditLedger });
  });

  it('returns an authenticated page of customer Store Credit activity', async () => {
    const request = new Request(
      `http://localhost/api/admin/customers/${customerId}/store-credit-ledger?page=2&limit=20`,
    );

    const response = await GET(request, context());

    expect(response.status).toBe(200);
    expect(requireAdminSession).toHaveBeenCalledOnce();
    expect(listStoreCreditLedger).toHaveBeenCalledWith(actor, customerId, {
      page: 2,
      limit: 20,
    });
    await expect(response.json()).resolves.toEqual({ ledger });
  });

  it('uses the modal page size defaults when query parameters are absent', async () => {
    const response = await GET(
      new Request(`http://localhost/api/admin/customers/${customerId}/store-credit-ledger`),
      context(),
    );

    expect(response.status).toBe(200);
    expect(listStoreCreditLedger).toHaveBeenCalledWith(actor, customerId, {
      page: 1,
      limit: 20,
    });
  });

  it('maps an unknown customer and invalid pagination to the existing admin API errors', async () => {
    for (const error of [
      new CustomerOperationsValidationError('Customer not found.'),
      new CustomerOperationsValidationError('Enter a valid page.'),
    ]) {
      listStoreCreditLedger.mockRejectedValueOnce(error);

      const response = await GET(
        new Request(`http://localhost/api/admin/customers/${customerId}/store-credit-ledger`),
        context(),
      );

      expect(response.status).toBe(error.message === 'Customer not found.' ? 404 : 400);
      await expect(response.json()).resolves.toEqual({ error: error.message });
    }
  });

  it('rejects requests without an authenticated admin session', async () => {
    requireAdminSession.mockRejectedValueOnce(
      new StaffAuthenticationError('Admin authentication is required.'),
    );

    const response = await GET(
      new Request(`http://localhost/api/admin/customers/${customerId}/store-credit-ledger`),
      context(),
    );

    expect(response.status).toBe(401);
    expect(listStoreCreditLedger).not.toHaveBeenCalled();
  });
});
