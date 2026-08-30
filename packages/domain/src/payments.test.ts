import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FakePaymentService, FakeTaxService, StripePaymentService } from './payments.js';

describe('platform payment and tax adapters', () => {
  it('supports deterministic success, failure, cancellation, pending, and duplicate-safe fake event identifiers', async () => {
    const payments = new FakePaymentService();
    const intent = await payments.createIntent({
      checkoutAttemptId: 'checkout-1',
      amountCents: 3211,
      currency: 'USD',
      idempotencyKey: 'checkout-idempotency-1',
      customerEmail: 'person@example.test',
    });
    expect(intent).toMatchObject({ provider: 'FAKE', status: 'PENDING' });
    for (const [eventName, outcome] of [
      ['payment_intent.succeeded', 'SUCCEEDED'],
      ['payment_intent.payment_failed', 'FAILED'],
      ['payment_intent.canceled', 'CANCELLED'],
      ['payment_intent.processing', 'PENDING'],
    ] as const) {
      await expect(
        payments.verifyWebhook({
          signature: 'fake-payment-signature',
          body: JSON.stringify({
            id: `evt-${eventName}`,
            type: eventName,
            data: { object: { id: intent.providerPaymentId, amount: 3211, currency: 'usd' } },
          }),
        }),
      ).resolves.toMatchObject({ outcome });
    }
    await expect(payments.verifyWebhook({ signature: 'wrong', body: '{}' })).resolves.toBeNull();
  });

  it('uses integer minor-unit rounding for development tax', async () => {
    const tax = new FakeTaxService(875);
    const result = await tax.calculate({
      subtotalCents: 1999,
      customerShippingCents: 500,
      address: { countryCode: 'US', stateCode: 'CA', postalCode: '94107' },
    });
    expect(result.taxCents).toBe(175);
    expect(result.taxableSubtotalCents).toBe(1999);
  });

  it('verifies Stripe-style webhook signatures without accepting altered content', async () => {
    const service = new StripePaymentService('sk_test_unused', 'whsec_test');
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', amount: 1200, currency: 'usd' } },
    });
    const timestamp = '1700000000';
    const signature = createHmac('sha256', 'whsec_test')
      .update(`${timestamp}.${body}`)
      .digest('hex');
    await expect(
      service.verifyWebhook({ body, signature: `t=${timestamp},v1=${signature}` }),
    ).resolves.toMatchObject({ provider: 'STRIPE', outcome: 'SUCCEEDED' });
    await expect(
      service.verifyWebhook({ body: `${body}x`, signature: `t=${timestamp},v1=${signature}` }),
    ).resolves.toBeNull();
  });
});
