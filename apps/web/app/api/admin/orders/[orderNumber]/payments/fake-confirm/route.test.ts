import { beforeEach, describe, expect, it, vi } from 'vitest';

import { actor, context, doubles, requestFor } from '../../_actions/route-test-support';

const runtime = vi.hoisted(() => ({ environment: vi.fn() }));
vi.mock('../../../../../../../lib/runtime-environment', () => ({
  serverEnvironment: runtime.environment,
}));

import { POST } from './route';

describe('local additional-payment simulation route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    doubles.requireAdminSession.mockResolvedValue(actor);
    doubles.orderAdminActionsRuntime.mockResolvedValue({
      editPayments: { simulateFakeSuccess: doubles.simulateAdditionalPayment },
    });
    doubles.simulateAdditionalPayment.mockResolvedValue({
      handled: true,
      duplicate: false,
      orderNumber: '#1',
      status: 'SUCCEEDED',
    });
  });

  it.each([
    ['production', 'stripe'],
    ['local', 'stripe'],
    ['production', 'fake'],
  ])('is unavailable in %s with %s payments', async (appEnv, adapter) => {
    runtime.environment.mockReturnValue({ APP_ENV: appEnv, PAYMENT_ADAPTER: adapter });
    const response = await POST(requestFor({}), context);
    expect(response.status).toBe(404);
    expect(doubles.simulateAdditionalPayment).not.toHaveBeenCalled();
  });

  it('settles through the authoritative service only for local fake payments', async () => {
    runtime.environment.mockReturnValue({ APP_ENV: 'local', PAYMENT_ADAPTER: 'fake' });
    const response = await POST(requestFor({}), context);
    expect(response.status).toBe(200);
    expect(doubles.simulateAdditionalPayment).toHaveBeenCalledWith(actor, { orderNumber: '#1' });
    expect(await response.json()).toEqual({ result: { status: 'SUCCEEDED' } });
  });

  it('denies read-only staff even when local fake payments are enabled', async () => {
    runtime.environment.mockReturnValue({ APP_ENV: 'local', PAYMENT_ADAPTER: 'fake' });
    doubles.requireAdminSession.mockResolvedValue({ ...actor, role: 'READ_ONLY' });
    const response = await POST(requestFor({}), context);
    expect(response.status).toBe(403);
    expect(doubles.simulateAdditionalPayment).not.toHaveBeenCalled();
  });
});
