import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentIntentRejectedError, PaymentIntentUncertainError } from '@let-it-be/domain';

import {
  actor,
  context,
  doubles,
  requestFor,
  routeContract,
  uuid,
} from '../_actions/route-test-support';
import { POST } from './route';

routeContract({
  name: 'prepare an additional order-edit payment',
  handler: POST,
  service: 'prepareAdditionalPayment',
  body: { orderRevisionId: uuid },
  result: {
    paymentAttemptId: uuid,
    orderRevisionId: uuid,
    status: 'PENDING',
    amountCents: 700,
    currency: 'USD',
    clientSecret: 'client-secret',
    duplicate: false,
  },
  invalid: [{ orderRevisionId: 'not-a-uuid' }, { orderRevisionId: uuid, amountCents: 700 }],
});

// Keep this explicit: provider payment identifiers must never cross the admin API.
describe('additional payment response boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    doubles.requireAdminSession.mockResolvedValue(actor);
    doubles.orderAdminActionsRuntime.mockResolvedValue({
      editPayments: { prepare: doubles.prepareAdditionalPayment },
    });
  });

  it('returns only the platform payment result', async () => {
    doubles.prepareAdditionalPayment.mockResolvedValue({
      paymentAttemptId: uuid,
      orderRevisionId: uuid,
      status: 'PENDING',
      amountCents: 700,
      currency: 'USD',
      clientSecret: 'client-secret',
      duplicate: false,
      providerPaymentId: 'pi_private',
    });
    const response = await POST(requestFor({ orderRevisionId: uuid }), context);
    expect(await response.text()).not.toContain('pi_private');
  });

  it.each([
    [new PaymentIntentRejectedError(), 409, 'ORDER_PAYMENT_REFUSED', false],
    [new PaymentIntentUncertainError(), 503, 'ORDER_PAYMENT_UNCERTAIN', true],
  ] as const)(
    'maps provider intent errors without leaking raw details',
    async (error, status, code, retryable) => {
      doubles.prepareAdditionalPayment.mockRejectedValue(error);
      const response = await POST(requestFor({ orderRevisionId: uuid }), context);
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ code, retryable });
    },
  );
});
