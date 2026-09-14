import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakePaymentService, FakeTaxService, StripePaymentService } from './payments.js';
import {
  PaymentIntentRejectedError,
  PaymentIntentUncertainError,
  type PaymentIntentRequest,
} from './commerce-contracts.js';

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
      reference: { kind: 'CHECKOUT', checkoutAttemptId: 'checkout-1' },
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

  it('creates provider intents with an explicit server-owned order-edit payment reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'pi_order_edit_1',
          client_secret: 'pi_order_edit_1_secret',
          status: 'requires_payment_method',
          amount: 725,
          currency: 'usd',
          metadata: {
            payment_reference_kind: 'ORDER_EDIT',
            order_id: '10000000-0000-4000-8000-000000000001',
            order_revision_id: '10000000-0000-4000-8000-000000000002',
            order_edit_payment_attempt_id: '10000000-0000-4000-8000-000000000003',
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const payments = new StripePaymentService('fixture', 'fixture');
    await expect(
      payments.createIntent({
        reference: {
          kind: 'ORDER_EDIT',
          orderId: '10000000-0000-4000-8000-000000000001',
          orderRevisionId: '10000000-0000-4000-8000-000000000002',
          orderEditPaymentAttemptId: '10000000-0000-4000-8000-000000000003',
        },
        amountCents: 725,
        currency: 'USD',
        idempotencyKey: 'order-edit-payment-001',
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
      }),
    ).resolves.toMatchObject({ providerPaymentId: 'pi_order_edit_1', status: 'PENDING' });
    const form = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(Object.fromEntries(form)).toMatchObject({
      'metadata[payment_reference_kind]': 'ORDER_EDIT',
      'metadata[order_id]': '10000000-0000-4000-8000-000000000001',
      'metadata[order_revision_id]': '10000000-0000-4000-8000-000000000002',
      'metadata[order_edit_payment_attempt_id]': '10000000-0000-4000-8000-000000000003',
    });
    expect(Object.fromEntries(form)).not.toHaveProperty('metadata[checkout_attempt_id]');
  });

  it('distinguishes a definitive PaymentIntent refusal from an ambiguous provider outcome', async () => {
    const request = orderEditIntentRequest();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { type: 'invalid_request_error' } }), {
            status: 400,
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { type: 'api_error' } }), { status: 503 }),
        ),
    );
    const payments = new StripePaymentService('fixture', 'fixture');
    await expect(payments.createIntent(request)).rejects.toBeInstanceOf(PaymentIntentRejectedError);
    await expect(payments.createIntent(request)).rejects.toBeInstanceOf(
      PaymentIntentUncertainError,
    );
  });

  it('finds and gets a PaymentIntent read-only and validates its immutable request identity', async () => {
    const request = orderEditIntentRequest();
    const providerIntent = {
      id: 'pi_order_edit_recovered',
      client_secret: 'pi_order_edit_recovered_secret',
      status: 'requires_payment_method',
      amount: request.amountCents,
      currency: 'usd',
      metadata: {
        payment_reference_kind: 'ORDER_EDIT',
        order_id: request.reference.kind === 'ORDER_EDIT' ? request.reference.orderId : '',
        order_revision_id:
          request.reference.kind === 'ORDER_EDIT' ? request.reference.orderRevisionId : '',
        order_edit_payment_attempt_id:
          request.reference.kind === 'ORDER_EDIT'
            ? request.reference.orderEditPaymentAttemptId
            : '',
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [providerIntent], has_more: false })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(providerIntent)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ ...providerIntent, amount: 1 }], has_more: false })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const payments = new StripePaymentService('fixture', 'fixture');
    await expect(payments.findIntent!(request)).resolves.toMatchObject({
      providerPaymentId: 'pi_order_edit_recovered',
      status: 'PENDING',
    });
    await expect(
      payments.getIntent!({ providerPaymentId: 'pi_order_edit_recovered', request }),
    ).resolves.toMatchObject({ providerPaymentId: 'pi_order_edit_recovered' });
    await expect(payments.findIntent!(request)).rejects.toBeInstanceOf(PaymentIntentUncertainError);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(true);
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

  it('rejects a signed provider event whose currency is not the platform USD currency', async () => {
    const payments = new FakePaymentService();
    await expect(
      payments.verifyWebhook({
        signature: 'fake-payment-signature',
        body: JSON.stringify({
          id: 'evt_wrong_currency',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_1', amount: 700, currency: 'eur' } },
        }),
      }),
    ).resolves.toBeNull();
  });
});

function orderEditIntentRequest(): PaymentIntentRequest {
  return {
    reference: {
      kind: 'ORDER_EDIT',
      orderId: '10000000-0000-4000-8000-000000000001',
      orderRevisionId: '10000000-0000-4000-8000-000000000002',
      orderEditPaymentAttemptId: '10000000-0000-4000-8000-000000000003',
    },
    amountCents: 725,
    currency: 'USD',
    idempotencyKey: 'order-edit-payment-001',
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
  };
}
