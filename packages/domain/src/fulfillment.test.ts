import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  FulfillmentIntegrationError,
  normalizeFulfillmentError,
  type FulfillmentService,
} from './fulfillment-contracts.js';
import { FakePrintifyFulfillmentAdapter, PrintifyFulfillmentAdapter } from './printify.js';

describe('Printify fulfillment boundary', () => {
  it('provides deterministic local catalog, availability, shipping, and explicit fake submission only after creation', async () => {
    const adapter: FulfillmentService = new FakePrintifyFulfillmentAdapter();
    const snapshot = await adapter.syncCatalog({
      externalBlueprintIds: ['fake-essential-dtg-tee-blueprint'],
    });
    expect(snapshot.blueprints[0]?.providers).toHaveLength(3);
    const order = await adapter.createOrder({
      idempotencyKey: 'safe-retry',
      externalProductId: 'fake-essential-dtg-tee-blueprint',
      items: [
        {
          externalVariantId: 'fake-essential-dtg-tee-black-M',
          quantity: 1,
          artworkReference: 'private-backend-reference',
        },
      ],
    });
    expect(order).toMatchObject({ externalOrderId: 'fake-order-safe-retry', state: 'CREATED' });
    await expect(
      adapter.quoteShipping({
        externalProviderId: 'fake-harbor',
        externalBlueprintId: 'fake-essential-dtg-tee-blueprint',
        externalVariantId: 'fake-essential-dtg-tee-black-M',
        destinationCountry: 'US',
      }),
    ).resolves.toMatchObject({ shippingCents: 550, estimatedDeliveryMaxDays: 8 });
    await expect(
      adapter.quoteShipping({
        externalProviderId: 'fake-harbor',
        externalBlueprintId: 'fake-essential-dtg-tee-blueprint',
        externalVariantId: 'fake-essential-dtg-tee-black-M',
        destinationCountry: 'GB',
      }),
    ).rejects.toMatchObject({ code: 'DESTINATION_UNSUPPORTED' });
    await expect(
      adapter.submitProduction({ idempotencyKey: 'test', externalOrderId: order.externalOrderId }),
    ).resolves.toBeUndefined();
    await expect(
      adapter.getOrderStatus({ externalOrderId: order.externalOrderId }),
    ).resolves.toMatchObject({ state: 'SUBMITTED' });
  });

  it('validates a signed Printify webhook without returning raw payload data', async () => {
    const body = JSON.stringify({
      id: 'evt-1',
      type: 'order:updated',
      resource: { id: 'order-1', status: 'sent-to-production' },
    });
    const secret = 'test-webhook-secret';
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    const adapter = new PrintifyFulfillmentAdapter({
      apiToken: 'server-only',
      shopId: '123',
      baseUrl: 'https://example.test',
      webhookSecret: secret,
      fetch: fetch,
    });
    await expect(adapter.verifyWebhook({ body, signature })).resolves.toEqual({
      valid: true,
      externalEventId: 'evt-1',
      eventName: 'order:updated',
      normalizedPayload: { orderId: 'order-1', status: 'sent-to-production' },
    });
    await expect(adapter.verifyWebhook({ body, signature: 'wrong' })).resolves.toMatchObject({
      valid: false,
    });
  });

  it('uses normalized retryable errors rather than provider response details', () => {
    const rateLimited = new FulfillmentIntegrationError('RATE_LIMIT', 'Provider response omitted.');
    expect(rateLimited.retryable).toBe(true);
    expect(normalizeFulfillmentError(new Error('secret response body'))).toMatchObject({
      code: 'UNKNOWN',
      retryable: false,
    });
  });

  it('maps real-adapter provider failures to safe operational categories', async () => {
    for (const [status, code, retryable] of [
      [401, 'AUTHENTICATION_ERROR', false],
      [429, 'RATE_LIMIT', true],
      [503, 'PROVIDER_ERROR', true],
    ] as const) {
      const adapter = new PrintifyFulfillmentAdapter({
        apiToken: 'provider-secret-never-returned',
        shopId: '123',
        baseUrl: 'https://print.example.test',
        fetch: vi.fn().mockResolvedValue(new Response('{}', { status })) as unknown as typeof fetch,
      });
      await expect(
        adapter.createOrder({
          idempotencyKey: `provider-${status}`,
          externalProductId: '1',
          items: [],
        }),
      ).rejects.toMatchObject({ code, retryable });
    }

    const networkFailure = new PrintifyFulfillmentAdapter({
      apiToken: 'provider-secret-never-returned',
      shopId: '123',
      baseUrl: 'https://print.example.test',
      fetch: vi.fn().mockRejectedValue(new Error('network unavailable')) as unknown as typeof fetch,
    });
    await expect(
      networkFailure.createOrder({ idempotencyKey: 'network', externalProductId: '1', items: [] }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });

    const malformedResponse = new PrintifyFulfillmentAdapter({
      apiToken: 'provider-secret-never-returned',
      shopId: '123',
      baseUrl: 'https://print.example.test',
      fetch: vi
        .fn()
        .mockResolvedValue(new Response('not-json', { status: 200 })) as unknown as typeof fetch,
    });
    await expect(
      malformedResponse.createOrder({
        idempotencyKey: 'malformed',
        externalProductId: '1',
        items: [],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false });
  });
});
