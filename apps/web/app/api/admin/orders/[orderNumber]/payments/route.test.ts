import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentIntentRejectedError, PaymentIntentUncertainError } from '@let-it-be/domain';

vi.mock('../../../../../../lib/runtime-environment', () => ({
  serverEnvironment: () => ({ APP_ENV: 'local', PAYMENT_ADAPTER: 'fake' }),
}));

import {
  actor,
  context,
  doubles,
  requestFor,
  routeContract,
  uuid,
} from '../_actions/route-test-support';
import { GET, POST } from './route';

routeContract({
  name: 'prepare an additional order-edit payment',
  handler: POST,
  service: 'prepareAdditionalPayment',
  body: {},
  result: {
    paymentAttemptId: uuid,
    orderRevisionId: uuid,
    status: 'PENDING',
    amountCents: 700,
    currency: 'USD',
    clientSecret: 'client-secret',
    duplicate: false,
    developmentSimulationAvailable: true,
  },
  invalid: [{ orderRevisionId: uuid }, { amountCents: 700 }],
});

// Keep this explicit: provider payment identifiers must never cross the admin API.
describe('additional payment response boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    doubles.requireAdminSession.mockResolvedValue(actor);
    doubles.orderAdminActionsRuntime.mockResolvedValue({
      editPayments: {
        prepare: doubles.prepareAdditionalPayment,
        readOrRecover: doubles.readAdditionalPayment,
      },
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
      developmentSimulationAvailable: true,
      providerPaymentId: 'pi_private',
    });
    const response = await POST(requestFor({}), context);
    expect(await response.text()).not.toContain('pi_private');
  });

  it.each([
    [new PaymentIntentRejectedError(), 409, 'ORDER_PAYMENT_REFUSED', false],
    [new PaymentIntentUncertainError(), 503, 'ORDER_PAYMENT_UNCERTAIN', true],
  ] as const)(
    'maps provider intent errors without leaking raw details',
    async (error, status, code, retryable) => {
      doubles.prepareAdditionalPayment.mockRejectedValue(error);
      const response = await POST(requestFor({}), context);
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ code, retryable });
    },
  );

  it('recovers the active attempt from authenticated server state without an idempotency header', async () => {
    doubles.readAdditionalPayment.mockResolvedValue({
      paymentAttemptId: uuid,
      orderRevisionId: uuid,
      status: 'PENDING',
      amountCents: 700,
      currency: 'USD',
      clientSecret: 'client-secret',
      duplicate: true,
    });
    const response = await GET(
      new Request('http://localhost/api/admin/orders/%231/payments'),
      context,
    );
    expect(response.status).toBe(200);
    expect(doubles.readAdditionalPayment).toHaveBeenCalledWith(actor, { orderNumber: '#1' });
    expect(await response.text()).not.toMatch(/providerPaymentId|pi_private/);
  });

  it.each(['READ_ONLY', 'PREPRESS'] as const)(
    'denies %s recovery reads before constructing the service',
    async (role) => {
      doubles.requireAdminSession.mockResolvedValue({ ...actor, role });
      const response = await GET(
        new Request('http://localhost/api/admin/orders/%231/payments'),
        context,
      );
      expect(response.status).toBe(403);
      expect(doubles.orderAdminActionsRuntime).not.toHaveBeenCalled();
    },
  );
});
