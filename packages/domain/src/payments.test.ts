import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakePaymentService, FakeTaxService, StripePaymentService } from './payments.js';

describe('platform payment and tax adapters', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { id: 're_other', status: 'succeeded', payment_intent: 'pi_other', amount: 100 },
    { id: 're_amount', status: 'succeeded', payment_intent: 'pi_expected', amount: 200 },
    { status: 'succeeded', payment_intent: 'pi_expected', amount: 100 },
  ])('does not declare an unconfirmed refund successful: %j', async (response) => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(response)));
    const payments = new StripePaymentService('fixture', 'fixture');
    await expect(
      payments.refund({
        providerPaymentId: 'pi_expected',
        amountCents: 100,
        idempotencyKey: 'fixture-key-0001',
      }),
    ).rejects.toThrow('Refund outcome is not confirmed');
  });

  it('preserves accepted nonterminal Stripe refunds for later reconciliation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 're_pending',
            status: 'pending',
            payment_intent: 'pi_expected',
            amount: 100,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 're_pending',
            status: 'succeeded',
            payment_intent: 'pi_expected',
            amount: 100,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            has_more: false,
            data: [
              {
                id: 're_pending',
                status: 'succeeded',
                payment_intent: 'pi_expected',
                amount: 100,
                metadata: { platform_refund_key: 'fixture-key-0001' },
              },
            ],
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const payments = new StripePaymentService('fixture', 'fixture');
    await expect(
      payments.refund({
        providerPaymentId: 'pi_expected',
        amountCents: 100,
        idempotencyKey: 'fixture-key-0001',
      }),
    ).resolves.toEqual({
      providerRefundId: 're_pending',
      status: 'PENDING',
      providerStatus: 'pending',
    });
    await expect(
      payments.getRefundStatus!({
        providerRefundId: 're_pending',
        providerPaymentId: 'pi_expected',
        amountCents: 100,
      }),
    ).resolves.toEqual({
      providerRefundId: 're_pending',
      status: 'SUCCEEDED',
      providerStatus: 'succeeded',
    });
    await expect(
      payments.findRefund!({
        providerPaymentId: 'pi_expected',
        amountCents: 100,
        idempotencyKey: 'fixture-key-0001',
      }),
    ).resolves.toEqual({
      providerRefundId: 're_pending',
      status: 'SUCCEEDED',
      providerStatus: 'succeeded',
    });
    expect(
      new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body)).get(
        'metadata[platform_refund_key]',
      ),
    ).toBe('fixture-key-0001');
  });
  it('supports deterministic success, failure, cancellation, pending, and duplicate-safe fake event identifiers', async () => {
    const payments = new FakePaymentService();
    const intent = await payments.createIntent({
      checkoutAttemptId: 'checkout-1',
      amountCents: 3211,
      currency: 'USD',
      idempotencyKey: 'checkout-idempotency-1',
      customerEmail: 'person@example.test',
      billingAddress: {
        recipientName: 'Person Example',
        line1: '1 Example Street',
        line2: null,
        city: 'San Francisco',
        stateCode: 'CA',
        postalCode: '94107',
        countryCode: 'US',
      },
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
      ).resolves.toMatchObject({ outcome, metadata: { paymentMethodType: 'card' } });
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
      data: {
        object: {
          id: 'pi_1',
          amount: 1200,
          currency: 'usd',
          payment_method_types: ['card'],
        },
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', 'whsec_test')
      .update(`${timestamp}.${body}`)
      .digest('hex');
    await expect(
      service.verifyWebhook({ body, signature: `t=${timestamp},v1=${signature}` }),
    ).resolves.toMatchObject({
      provider: 'STRIPE',
      outcome: 'SUCCEEDED',
      metadata: { paymentMethodType: 'card' },
    });
    await expect(
      service.verifyWebhook({ body: `${body}x`, signature: `t=${timestamp},v1=${signature}` }),
    ).resolves.toBeNull();
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 301);
    const staleSignature = createHmac('sha256', 'whsec_test')
      .update(`${staleTimestamp}.${body}`)
      .digest('hex');
    await expect(
      service.verifyWebhook({ body, signature: `t=${staleTimestamp},v1=${staleSignature}` }),
    ).resolves.toBeNull();
  });
});
