import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  settle: vi.fn(),
  ingestPaymentWebhook: vi.fn(),
  paymentWebhookRuntime: vi.fn(),
  commerceRuntime: vi.fn(),
}));

vi.mock('../../../../lib/platform', () => ({
  paymentWebhookRuntime: runtime.paymentWebhookRuntime,
  commerceRuntime: runtime.commerceRuntime,
}));

import { POST } from './route';

const body = JSON.stringify({ id: 'evt_1' });
const request = () =>
  new Request('http://localhost/api/payments/webhook', {
    method: 'POST',
    headers: { 'x-fake-payment-signature': 'fake-payment-signature' },
    body,
  });

describe('payment webhook dispatch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    runtime.paymentWebhookRuntime.mockReturnValue({
      payments: { verifyWebhook: runtime.verifyWebhook },
      editPayments: { settle: runtime.settle },
    });
    runtime.commerceRuntime.mockResolvedValue({
      ingestPaymentWebhook: runtime.ingestPaymentWebhook,
    });
  });

  it('settles a verified order-edit payment without entering checkout payment persistence', async () => {
    runtime.verifyWebhook.mockResolvedValue({
      metadata: { payment_reference_kind: 'ORDER_EDIT' },
    });
    runtime.settle.mockResolvedValue({
      handled: true,
      duplicate: false,
      orderNumber: '#1',
      status: 'SUCCEEDED',
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, duplicate: false, orderNumber: '#1' });
    expect(runtime.settle).toHaveBeenCalledOnce();
    expect(runtime.ingestPaymentWebhook).not.toHaveBeenCalled();
  });

  it('keeps verified checkout events on the existing payment path', async () => {
    runtime.verifyWebhook.mockResolvedValue({
      metadata: { payment_reference_kind: 'CHECKOUT' },
    });
    runtime.ingestPaymentWebhook.mockResolvedValue({ duplicate: false, orderNumber: '#2' });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(runtime.settle).not.toHaveBeenCalled();
    expect(runtime.ingestPaymentWebhook).toHaveBeenCalledWith({
      body,
      signature: 'fake-payment-signature',
    });
  });

  it('rejects an order-edit event that cannot be settled exactly', async () => {
    runtime.verifyWebhook.mockResolvedValue({
      metadata: { payment_reference_kind: 'ORDER_EDIT' },
    });
    runtime.settle.mockRejectedValue(new Error('provider details'));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('provider details');
    expect(runtime.ingestPaymentWebhook).not.toHaveBeenCalled();
  });
});
