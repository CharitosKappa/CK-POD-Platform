import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  StoreCreditAccessError,
  StoreCreditConflictError,
  StoreCreditValidationError,
} from '@let-it-be/domain';

const { adjust, requireAdminSession, storeCreditRuntime } = vi.hoisted(() => ({
  adjust: vi.fn(),
  requireAdminSession: vi.fn(),
  storeCreditRuntime: vi.fn(),
}));

vi.mock('../../../../../../lib/platform', () => ({
  requireAdminSession,
  storeCreditRuntime,
}));

import { POST } from './route';

const customerId = '3c127006-3b01-4846-af60-a9fcfaf86d57';
const actor = {
  id: '0aa23cc6-5224-42d6-8c14-a05775f82c00',
  staffMemberId: '58f8dd03-6925-431a-8674-8efab810c7dd',
  email: 'owner@example.com',
  role: 'OWNER' as const,
  expiresAt: new Date('2026-09-13T00:00:00.000Z'),
};
const body = {
  direction: 'CREDIT',
  amount: '25.00',
  reason: 'PROMOTION',
  note: 'Labor Day goodwill credit',
  idempotencyKey: 'store-credit-<client-generated-uuid>',
};
const adjustment = {
  entryId: '025d7a27-41a4-45bc-a32b-cb86bd9d89db',
  balanceCents: 2500,
  currency: 'USD' as const,
  duplicate: false,
};

function request(): Request {
  return new Request(
    `http://localhost/api/admin/customers/${customerId}/store-credit-adjustments`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function context() {
  return { params: Promise.resolve({ customerId }) };
}

describe('POST /api/admin/customers/[customerId]/store-credit-adjustments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSession.mockResolvedValue(actor);
    adjust.mockResolvedValue(adjustment);
    storeCreditRuntime.mockReturnValue({ adjust });
  });

  it('passes the authenticated staff actor and adjustment payload to StoreCreditService', async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(requireAdminSession).toHaveBeenCalledOnce();
    expect(storeCreditRuntime).toHaveBeenCalledOnce();
    expect(adjust).toHaveBeenCalledWith(actor, customerId, body);
    expect(requireAdminSession.mock.invocationCallOrder[0]).toBeLessThan(
      adjust.mock.invocationCallOrder[0]!,
    );
    expect(adjust.mock.calls[0]?.[2].amount).toBe('25.00');
  });

  it('returns the new USD balance and ledger entry', async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ adjustment });
  });

  it('maps validation errors to 400, insufficient balance to 409, and access errors to 403', async () => {
    const cases = [
      {
        error: new StoreCreditValidationError('Enter a valid USD amount.'),
        status: 400,
      },
      {
        error: new StoreCreditValidationError('Customer not found.'),
        status: 404,
      },
      {
        error: new StoreCreditConflictError('Store credit cannot be reduced below $0.00.'),
        status: 409,
      },
      {
        error: new StoreCreditAccessError('You do not have permission to adjust store credit.'),
        status: 403,
      },
    ];

    for (const testCase of cases) {
      adjust.mockRejectedValueOnce(testCase.error);

      const response = await POST(request(), context());

      expect(response.status).toBe(testCase.status);
      await expect(response.json()).resolves.toEqual({ error: testCase.error.message });
    }
  });
});
