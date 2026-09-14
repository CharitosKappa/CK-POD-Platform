import { beforeEach, describe, expect, it, vi } from 'vitest';

import { actor, doubles, key, requestFor, uuid } from '../../../_actions/route-test-support';

import { POST } from './route';

const context = { params: Promise.resolve({ orderNumber: '%231', refundId: uuid }) };

describe('pending refund reconciliation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    doubles.requireAdminSession.mockResolvedValue(actor);
    doubles.orderAdminActionsRuntime.mockResolvedValue({ refunds: doubles });
    doubles.reconcileRefund.mockResolvedValue({
      refundId: uuid,
      destination: 'ORIGINAL_PAYMENT',
      amountCents: 1200,
      status: 'PENDING',
      duplicate: true,
      providerRefundId: 'provider-private',
    });
  });

  it('reconciles by durable refund id with a separate recovery key and returns 202 while pending', async () => {
    const response = await POST(requestFor({}), context);

    expect(response.status).toBe(202);
    expect(doubles.reconcileRefund).toHaveBeenCalledWith(
      { type: 'STAFF', ...actor },
      { orderNumber: '#1', refundId: uuid, idempotencyKey: key },
    );
    expect(await response.json()).toEqual({
      result: {
        refundId: uuid,
        destination: 'ORIGINAL_PAYMENT',
        amountCents: 1200,
        status: 'PENDING',
        duplicate: true,
      },
    });
  });

  it('returns 200 for a terminal succeeded state', async () => {
    doubles.reconcileRefund.mockResolvedValue({
      refundId: uuid,
      destination: 'ORIGINAL_PAYMENT',
      amountCents: 1200,
      status: 'SUCCEEDED',
      duplicate: true,
      providerRefundId: 'provider-private',
    });

    const response = await POST(requestFor({}), context);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ result: { status: 'SUCCEEDED' } });
    expect(JSON.stringify(payload)).not.toContain('provider-private');
  });

  it('returns an explicit 409 incomplete result for a terminal failed refund', async () => {
    doubles.reconcileRefund.mockResolvedValue({
      refundId: uuid,
      destination: 'ORIGINAL_PAYMENT',
      amountCents: 1200,
      succeededAmountCents: 0,
      failedAmountCents: 1200,
      status: 'FAILED',
      duplicate: true,
      providerRefundId: 'provider-private',
    });

    const response = await POST(requestFor({}), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'The refund was not completed. The amount is available to refund again.',
      code: 'REFUND_FAILED',
      result: {
        refundId: uuid,
        destination: 'ORIGINAL_PAYMENT',
        amountCents: 1200,
        succeededAmountCents: 0,
        failedAmountCents: 1200,
        status: 'FAILED',
        duplicate: true,
      },
    });
  });

  it('returns 409 and safe amounts when reconciliation reaches a terminal partial result', async () => {
    doubles.reconcileRefund.mockResolvedValue({
      refundId: uuid,
      destination: 'ORIGINAL_PAYMENT',
      amountCents: 1200,
      succeededAmountCents: 700,
      failedAmountCents: 500,
      status: 'PARTIAL',
      duplicate: true,
      providerRefundId: 'provider-private',
    });

    const response = await POST(requestFor({}), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        'Only part of the refund completed. The remaining amount is available to refund again.',
      code: 'REFUND_PARTIAL',
      result: {
        refundId: uuid,
        destination: 'ORIGINAL_PAYMENT',
        amountCents: 1200,
        succeededAmountCents: 700,
        failedAmountCents: 500,
        status: 'PARTIAL',
        duplicate: true,
      },
    });
  });

  it('returns 404 when the refund does not belong to the order', async () => {
    doubles.reconcileRefund.mockResolvedValue(null);
    expect((await POST(requestFor({}), context)).status).toBe(404);
  });

  it('rejects mutation-shaped bodies and malformed refund identifiers', async () => {
    expect((await POST(requestFor({ amountCents: 1200 }), context)).status).toBe(400);
    expect(
      (
        await POST(requestFor({}), {
          params: Promise.resolve({ orderNumber: '%231', refundId: 'not-a-uuid' }),
        })
      ).status,
    ).toBe(400);
    expect(doubles.reconcileRefund).not.toHaveBeenCalled();
  });

  it('requires an operations-capable admin', async () => {
    doubles.requireAdminSession.mockResolvedValue({ ...actor, role: 'READ_ONLY' });
    expect((await POST(requestFor({}), context)).status).toBe(403);
    expect(doubles.reconcileRefund).not.toHaveBeenCalled();
  });
});
