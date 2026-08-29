import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  FulfillmentIntegrationError,
  normalizeFulfillmentError,
  type FulfillmentService,
} from './fulfillment-contracts.js';
import { FakePrintifyFulfillmentAdapter, PrintifyFulfillmentAdapter } from './printify.js';

describe('Printify fulfillment boundary', () => {
  it('provides deterministic local catalog, availability, shipping, and no production submission', async () => {
    const adapter: FulfillmentService = new FakePrintifyFulfillmentAdapter();
    const snapshot = await adapter.syncCatalog({
      externalBlueprintIds: ['fake-essential-dtg-tee-blueprint'],
    });
    expect(snapshot.blueprints[0]?.providers).toHaveLength(3);
    await expect(
      adapter.createOrder({
        idempotencyKey: 'safe-retry',
        externalProductId: 'fake-essential-dtg-tee-blueprint',
        items: [
          {
            externalVariantId: 'fake-essential-dtg-tee-black-M',
            quantity: 1,
            artworkReference: 'private-backend-reference',
          },
        ],
      }),
    ).resolves.toMatchObject({ externalOrderId: 'fake-order-safe-retry', state: 'CREATED' });
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
      adapter.submitProduction({ idempotencyKey: 'test', externalOrderId: 'order' }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
    });
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
});
