import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  FulfillmentIntegrationError,
  normalizeFulfillmentError,
  type FulfillmentService,
} from './fulfillment-contracts.js';
import { FakePrintifyFulfillmentAdapter, PrintifyFulfillmentAdapter } from './printify.js';

describe('Printify fulfillment boundary', () => {
  // Break caught: fake cancellation fails to update submitted orders or changes on retry.
  it('cancels a submitted fake order deterministically', async () => {
    const adapter: FulfillmentService = new FakePrintifyFulfillmentAdapter();
    const order = await adapter.createOrder({ idempotencyKey: 'cancel-test', items: [] });
    await adapter.submitProduction({ idempotencyKey: 'submit-test', ...order });
    const input = { externalOrderId: order.externalOrderId, idempotencyKey: 'cancel-1' };
    await expect(adapter.cancelOrder(input)).resolves.toEqual({
      state: 'CANCELLED',
      occurredAt: null,
    });
    await expect(adapter.cancelOrder(input)).resolves.toEqual({
      state: 'CANCELLED',
      occurredAt: null,
    });
    await expect(adapter.getOrderStatus(input)).resolves.toMatchObject({ state: 'CANCELLED' });
  });

  // Break caught: wrong route/method/authentication or trusting a successful HTTP code alone.
  it('cancels through the authenticated provider boundary and normalizes the confirmed result', async () => {
    const requests: Request[] = [];
    const adapter = cancellationAdapter(async (request) => {
      requests.push(request);
      return Response.json(cancellationOrder(request.method === 'POST' ? 'canceled' : 'on-hold'));
    });
    await expect(adapter.cancelOrder(cancellationInput)).resolves.toEqual({
      state: 'CANCELLED',
      occurredAt: null,
    });
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['GET', 'https://print.example.test/v1/shops/shop%2F123/orders/provider%2F1.json'],
      ['POST', 'https://print.example.test/v1/shops/shop%2F123/orders/provider%2F1/cancel.json'],
    ]);
    expect(requests[1]!.headers.get('authorization')).toBe('Bearer server-only-secret');
    expect(requests[1]!.headers.get('idempotency-key')).toBe('cancel-0001');
    expect(await requests[1]!.text()).toBe('');
    expect(requests[1]!.url).not.toContain('server-only-secret');
  });

  // Break caught: duplicate cancellation issues another POST or reports provider refusal after success.
  it('recognizes previously canceled orders across adapter instances and retries', async () => {
    let status = 'payment-not-received';
    let writes = 0;
    const transport = async (request: Request) => {
      if (request.method === 'POST') {
        writes += 1;
        status = 'canceled';
      }
      return Response.json(cancellationOrder(status));
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(cancellationAdapter(transport).cancelOrder(cancellationInput)).resolves.toEqual({
        state: 'CANCELLED',
        occurredAt: null,
      });
    }
    expect(writes).toBe(1);
  });

  // Break caught: explicit HTTP refusal is treated as cancellation or a retryable outage.
  it.each([400, 404, 409, 422])(
    'maps cancellation refusal HTTP %i to unavailable',
    async (status) => {
      const adapter = cancellationAdapter(async (request) =>
        request.method === 'GET'
          ? Response.json(cancellationOrder('on-hold'))
          : Response.json({ status: 'error', message: 'private provider detail' }, { status }),
      );
      await expect(adapter.cancelOrder(cancellationInput)).resolves.toEqual({
        state: 'UNAVAILABLE',
        occurredAt: null,
      });
    },
  );

  // Break caught: authentication, rate limiting, or server outages are treated as terminal refusal.
  it.each([
    [401, 'AUTHENTICATION_ERROR'],
    [403, 'AUTHENTICATION_ERROR'],
    [429, 'RATE_LIMIT'],
    [503, 'PROVIDER_ERROR'],
  ] as const)('keeps HTTP %i cancellation failures typed', async (status, code) => {
    const adapter = cancellationAdapter(async (request) =>
      request.method === 'GET'
        ? Response.json(cancellationOrder('on-hold'))
        : Response.json({}, { status }),
    );
    await expect(adapter.cancelOrder(cancellationInput)).rejects.toMatchObject({
      name: 'FulfillmentIntegrationError',
      code,
    });
  });

  // Break caught: an absent, mismatched, or unconfirmed order response claims cancellation.
  it.each([
    ['{}', 200],
    ['null', 200],
    ['not-json', 200],
    [JSON.stringify({ id: 'wrong-order', status: 'canceled' }), 200],
    [JSON.stringify(cancellationOrder('sending-to-production')), 200],
    [JSON.stringify(cancellationOrder('canceled')), 202],
  ])('rejects ambiguous cancellation response %s (HTTP %i)', async (body, status) => {
    const adapter = cancellationAdapter(async (request) =>
      request.method === 'GET'
        ? Response.json(cancellationOrder('on-hold'))
        : new Response(body, { status }),
    );
    await expect(adapter.cancelOrder(cancellationInput)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  // Break caught: preflight failure still sends a cancellation request or returns success.
  it('fails closed when the initial order status cannot be verified', async () => {
    const methods: string[] = [];
    const adapter = cancellationAdapter(async (request) => {
      methods.push(request.method);
      return Response.json({});
    });
    await expect(adapter.cancelOrder(cancellationInput)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(methods).toEqual(['GET']);
  });

  // Break caught: request identity masquerades as verified provider identity during recovery.
  it.each([
    { name: 'mismatched', payload: { id: 'another-private-order', status: 'canceled' } },
    { name: 'missing', payload: { status: 'canceled' } },
  ])('rejects a $name response ID during read-only status verification', async ({ payload }) => {
    const adapter = cancellationAdapter(async () =>
      Response.json({
        ...payload,
        customer: { email: 'private-provider-customer@example.test' },
      }),
    );
    const result = await adapter.getOrderStatus(cancellationInput).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(FulfillmentIntegrationError);
    expect(result).toMatchObject({ code: 'INVALID_RESPONSE', retryable: false });
    for (const representation of [String(result), JSON.stringify(result)]) {
      expect(representation).not.toContain('another-private-order');
      expect(representation).not.toContain('private-provider-customer');
      expect(representation).not.toContain('server-only-secret');
    }
  });

  it.each(['in-production', 'fulfilled', undefined])(
    'preserves matching-identity non-cancellation status %s',
    async (status) => {
      const adapter = cancellationAdapter(async () => Response.json({ id: 'provider/1', status }));
      await expect(adapter.getOrderStatus({ externalOrderId: 'provider/1' })).resolves.toEqual({
        externalOrderId: 'provider/1',
        state: status ?? 'UNKNOWN',
        occurredAt: null,
      });
    },
  );

  // Break caught: timeout/unknown errors leak transport secrets or resolve as cancellation.
  it.each([
    [new DOMException('server-only-secret', 'AbortError'), 'TIMEOUT'],
    [new DOMException('server-only-secret', 'TimeoutError'), 'TIMEOUT'],
    [new TypeError('server-only-secret'), 'NETWORK_ERROR'],
    [new Error('server-only-secret'), 'NETWORK_ERROR'],
  ] as const)('normalizes transport failure %s to %s', async (failure, code) => {
    const adapter = cancellationAdapter(async (request) => {
      if (request.method === 'GET') return Response.json(cancellationOrder('on-hold'));
      throw failure;
    });
    const error = await adapter.cancelOrder(cancellationInput).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FulfillmentIntegrationError);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain('server-only-secret');
    expect(JSON.stringify(error)).not.toContain('server-only-secret');
  });

  // Break caught: simultaneous retries post twice and give callers conflicting results.
  it('coalesces concurrent cancellation attempts for the same provider order', async () => {
    let writes = 0;
    const adapter = cancellationAdapter(async (request) => {
      if (request.method === 'GET') return Response.json(cancellationOrder('on-hold'));
      writes += 1;
      return writes === 1
        ? Response.json(cancellationOrder('canceled'))
        : Response.json({}, { status: 400 });
    });
    const results = await Promise.all([
      adapter.cancelOrder(cancellationInput),
      adapter.cancelOrder(cancellationInput),
    ]);
    expect(results).toEqual([
      { state: 'CANCELLED', occurredAt: null },
      { state: 'CANCELLED', occurredAt: null },
    ]);
    expect(writes).toBe(1);
  });

  // Break caught: a response body timeout is misclassified as malformed JSON.
  it('reports a timeout while reading the cancellation response body', async () => {
    const adapter = cancellationAdapter(async (request) => {
      if (request.method === 'GET') return Response.json(cancellationOrder('on-hold'));
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new DOMException('private transport detail', 'AbortError'));
          },
        }),
      );
    });
    await expect(adapter.cancelOrder(cancellationInput)).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
  });

  // Break caught: an interrupted response causes a retry to repeat a completed cancellation.
  it('reconciles a cancellation after a lost response without a second write', async () => {
    let status = 'on-hold';
    let writes = 0;
    const adapter = cancellationAdapter(async (request) => {
      if (request.method === 'POST') {
        writes += 1;
        status = 'canceled';
        throw new TypeError('connection lost');
      }
      return Response.json(cancellationOrder(status));
    });
    await expect(adapter.cancelOrder(cancellationInput)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    await expect(adapter.cancelOrder(cancellationInput)).resolves.toEqual({
      state: 'CANCELLED',
      occurredAt: null,
    });
    expect(writes).toBe(1);
  });

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
        destinationCountry: 'US',
        items: [
          {
            externalBlueprintId: 'fake-essential-dtg-tee-blueprint',
            externalVariantId: 'fake-essential-dtg-tee-black-M',
            quantity: 1,
          },
        ],
      }),
    ).resolves.toMatchObject({ shippingCents: 550, estimatedDeliveryMaxDays: 8 });
    await expect(
      adapter.quoteShipping({
        externalProviderId: 'fake-harbor',
        destinationCountry: 'US',
        items: [
          {
            externalBlueprintId: 'fake-essential-dtg-tee-blueprint',
            externalVariantId: 'fake-essential-dtg-tee-black-2XL',
            quantity: 1,
          },
        ],
      }),
    ).resolves.toMatchObject({ shippingCents: 550, estimatedDeliveryMaxDays: 8 });
    await expect(
      adapter.quoteShipping({
        externalProviderId: 'fake-harbor',
        destinationCountry: 'GB',
        items: [
          {
            externalBlueprintId: 'fake-essential-dtg-tee-blueprint',
            externalVariantId: 'fake-essential-dtg-tee-black-M',
            quantity: 1,
          },
        ],
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

const cancellationInput = { externalOrderId: 'provider/1', idempotencyKey: 'cancel-0001' };

function cancellationAdapter(transport: (request: Request) => Promise<Response>) {
  return new PrintifyFulfillmentAdapter({
    apiToken: 'server-only-secret',
    shopId: 'shop/123',
    baseUrl: 'https://print.example.test/v1',
    fetch: async (input, init) => transport(new Request(input, init)),
  });
}

function cancellationOrder(status: string) {
  return {
    id: 'provider/1',
    app_order_id: '215014.44',
    status,
    address_to: {
      first_name: 'Test',
      last_name: 'Buyer',
      email: 'buyer@example.test',
      country: 'US',
      region: 'CA',
      address1: '1 Test Street',
      city: 'Test City',
      zip: '92653',
    },
    line_items: [
      {
        quantity: 1,
        product_id: 'product-1',
        variant_id: 34509,
        print_provider_id: 6,
        shipping_cost: 450,
        cost: 0,
        status,
        metadata: {
          title: 'Test Shirt',
          variant_label: 'S / Red',
          sku: '3640',
          country: 'United Kingdom',
        },
      },
    ],
    metadata: {
      order_type: 'api',
      shop_order_id: 'order-1',
      shop_order_label: 'order-1',
      shop_fulfilled_at: '1970-01-01 00:00:00+00:00',
      is_reprint: false,
      reprinted_order_ids: [],
      child_reprinted_order_ids: [],
    },
    total_price: 0,
    total_shipping: 0,
    total_tax: 0,
    shipping_method: 1,
    is_printify_express: false,
    is_economy_shipping: false,
    created_at: '2019-12-09 10:46:53+00:00',
  };
}
