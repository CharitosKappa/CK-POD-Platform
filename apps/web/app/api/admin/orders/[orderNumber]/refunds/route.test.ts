import { beforeEach, describe, expect, it } from 'vitest';
import {
  routeContract,
  uuid,
  doubles,
  requestFor,
  context,
  actor,
} from '../_actions/route-test-support';
import { POST } from './route';
const base = { amountCents: 3999, reasonCode: 'CUSTOMER_REQUEST', note: 'Goodwill' };
for (const [destination, service] of [
  ['ORIGINAL_PAYMENT', 'refundOriginalPayment'],
  ['STORE_CREDIT', 'refundToStoreCredit'],
] as const)
  routeContract({
    name: destination + ' refund',
    handler: POST,
    service,
    body: { ...base, destination },
    forwarded: base,
    refund: true,
    invalid: [
      { ...base, destination: 'LATER' },
      { ...base, destination, amountCents: 0 },
      { ...base, destination, amountCents: 2.5 },
      { ...base, destination, reasonCode: 'UNKNOWN' },
    ],
  });
describe('Refund settlement outcomes', () => {
  beforeEach(() => {
    doubles.requireAdminSession.mockResolvedValue(actor);
    doubles.getOrder.mockResolvedValue({ id: uuid });
    doubles.orderAdminActionsRuntime.mockResolvedValue({
      refunds: doubles,
      detail: { getOrder: doubles.getOrder },
    });
  });
  it('refreshes eligibility after a concurrent refund balance conflict', async () => {
    const eligibility = { actions: { refund: false } };
    doubles.getOrder
      .mockResolvedValueOnce({ id: uuid })
      .mockResolvedValueOnce({ id: uuid, eligibility });
    doubles.refundOriginalPayment.mockRejectedValue(
      new Error('Refund exceeds the captured payment.'),
    );
    const response = await POST(requestFor({ ...base, destination: 'ORIGINAL_PAYMENT' }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'ORDER_ACTION_CONFLICT', eligibility });
  });
  it('redacts internal provider identifiers from successful refunds', async () => {
    doubles.refundOriginalPayment.mockResolvedValue({
      status: 'SUCCEEDED',
      refundId: uuid,
      providerRefundId: 'provider-private',
    });
    const response = await POST(requestFor({ ...base, destination: 'ORIGINAL_PAYMENT' }), context);
    expect(await response.json()).toEqual({ result: { status: 'SUCCEEDED', refundId: uuid } });
  });
  it('distinguishes missing order from unpaid order', async () => {
    doubles.getOrder.mockResolvedValue(null);
    const response = await POST(requestFor({ ...base, destination: 'ORIGINAL_PAYMENT' }), context);
    expect(response.status).toBe(404);
  });
  for (const message of [
    'Order payment is unavailable.',
    'Refund exceeds the captured payment.',
    'Refund idempotency key belongs to another order.',
  ])
    it('maps existing refund conflict: ' + message, async () => {
      doubles.refundOriginalPayment.mockRejectedValue(new Error(message));
      expect(
        (await POST(requestFor({ ...base, destination: 'ORIGINAL_PAYMENT' }), context)).status,
      ).toBe(409);
    });
  it('maps configured payment refusal without exposing details', async () => {
    doubles.refundOriginalPayment.mockRejectedValue(
      new Error('Stripe could not process the refund.'),
    );
    const response = await POST(requestFor({ ...base, destination: 'ORIGINAL_PAYMENT' }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'ORDER_PROVIDER_FAILURE' });
  });
  for (const [status, httpStatus] of [
    ['PENDING', 202],
    ['FAILED', 409],
  ] as const)
    it('does not call ' + status + ' refund successful', async () => {
      doubles.refundOriginalPayment.mockResolvedValue({
        status,
        refundId: uuid,
        providerRefundId: null,
      });
      const response = await POST(
        requestFor({ ...base, destination: 'ORIGINAL_PAYMENT' }),
        context,
      );
      expect(response.status).toBe(httpStatus);
      expect(await response.json()).toMatchObject({ result: { status } });
    });
});
