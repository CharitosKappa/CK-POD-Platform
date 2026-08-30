import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  FulfillmentIntegrationError,
  type FulfillmentCatalogSnapshot,
  type FulfillmentOrderRequest,
  type FulfillmentOrderResult,
  type FulfillmentService,
  type FulfillmentStatus,
  type FulfillmentWebhookVerification,
  type NormalizedShippingQuote,
  type ShippingQuoteRequest,
} from './fulfillment-contracts';

export interface PrintifyAdapterOptions {
  apiToken: string;
  shopId: string;
  baseUrl: string;
  webhookSecret?: string;
  fetch?: typeof fetch;
}

export function createFulfillmentAdapter(input: {
  adapter: 'fake' | 'printify';
  apiToken?: string;
  shopId?: string;
  baseUrl: string;
  webhookSecret?: string;
}): FulfillmentService {
  if (input.adapter === 'fake') return new FakePrintifyFulfillmentAdapter();
  if (!input.apiToken || !input.shopId) {
    throw new FulfillmentIntegrationError(
      'CONFIGURATION_ERROR',
      'Printify credentials are required for the real fulfillment adapter.',
      { retryable: false },
    );
  }
  return new PrintifyFulfillmentAdapter({
    apiToken: input.apiToken,
    shopId: input.shopId,
    baseUrl: input.baseUrl,
    ...(input.webhookSecret ? { webhookSecret: input.webhookSecret } : {}),
  });
}

/**
 * The real, server-only Printify adapter. Its responses are normalized here,
 * so vendor fields cannot become application contracts.
 */
export class PrintifyFulfillmentAdapter implements FulfillmentService {
  private readonly fetchImplementation: typeof fetch;

  public constructor(private readonly options: PrintifyAdapterOptions) {
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async syncCatalog(input: {
    externalBlueprintIds: string[];
  }): Promise<FulfillmentCatalogSnapshot> {
    const blueprints = await Promise.all(
      input.externalBlueprintIds.map(async (externalBlueprintId) => {
        const blueprint = await this.request<Record<string, unknown>>(
          `/catalog/blueprints/${encodeURIComponent(externalBlueprintId)}.json`,
        );
        const providers = await this.request<Array<Record<string, unknown>>>(
          `/catalog/blueprints/${encodeURIComponent(externalBlueprintId)}/print_providers.json`,
        );
        const normalizedProviders = await Promise.all(
          providers.map(async (provider) => {
            const externalProviderId = requiredIdentifier(
              provider.id,
              'Print provider ID is missing.',
            );
            const providerVariants = await this.request<Record<string, unknown>>(
              `/catalog/blueprints/${encodeURIComponent(externalBlueprintId)}/print_providers/${encodeURIComponent(externalProviderId)}/variants.json`,
            );
            const variants = Array.isArray(providerVariants.variants)
              ? providerVariants.variants
              : [];
            return {
              externalProviderId,
              displayName: stringValue(provider.title) ?? 'Print provider',
              available: true,
              capabilities: { decorationMethods: ['DTG'], destinationCountries: [] },
              variants: variants.flatMap((variant) => {
                if (!variant || typeof variant !== 'object') return [];
                const item = variant as Record<string, unknown>;
                const externalVariantId = identifierValue(item.id);
                return externalVariantId
                  ? [{ externalVariantId, available: item.is_available !== false }]
                  : [];
              }),
            };
          }),
        );
        return {
          externalBlueprintId,
          displayName: stringValue(blueprint.title) ?? `Blueprint ${externalBlueprintId}`,
          available: true,
          providers: normalizedProviders,
        };
      }),
    );
    return { blueprints, observedAt: new Date() };
  }

  async quoteShipping(input: ShippingQuoteRequest): Promise<NormalizedShippingQuote> {
    const response = await this.request<Record<string, unknown>>(
      `/shops/${encodeURIComponent(this.options.shopId)}/orders/shipping.json`,
      {
        method: 'POST',
        body: JSON.stringify({
          line_items: [
            {
              blueprint_id: Number(input.externalBlueprintId),
              print_provider_id: Number(input.externalProviderId),
              variant_id: Number(input.externalVariantId),
              quantity: 1,
            },
          ],
          address_to: { country: input.destinationCountry },
        }),
      },
    );
    const shipping = Array.isArray(response.shipping_methods) ? response.shipping_methods[0] : null;
    if (!shipping || typeof shipping !== 'object') {
      throw new FulfillmentIntegrationError(
        'SHIPPING_UNAVAILABLE',
        'No shipping quote is available.',
      );
    }
    const item = shipping as Record<string, unknown>;
    return {
      method: stringValue(item.name) ?? 'Standard',
      shippingCents: cents(item.price),
      currency: stringValue(item.currency) ?? 'USD',
      estimatedDeliveryMinDays: numberValue(item.min_delivery_days),
      estimatedDeliveryMaxDays: numberValue(item.max_delivery_days),
      estimateKind: 'PROVIDER_SLA',
      expiresAt: null,
    };
  }

  async createOrder(input: FulfillmentOrderRequest): Promise<FulfillmentOrderResult> {
    const response = await this.request<Record<string, unknown>>(
      `/shops/${encodeURIComponent(this.options.shopId)}/orders.json`,
      {
        method: 'POST',
        headers: { 'idempotency-key': input.idempotencyKey },
        body: JSON.stringify({ external_id: input.idempotencyKey, line_items: input.items }),
      },
    );
    return {
      externalOrderId: requiredIdentifier(response.id, 'Printify order ID is missing.'),
      state: 'CREATED',
    };
  }

  async submitProduction(input: {
    idempotencyKey: string;
    externalOrderId: string;
  }): Promise<void> {
    await this.request<Record<string, unknown>>(
      `/shops/${encodeURIComponent(this.options.shopId)}/orders/${encodeURIComponent(input.externalOrderId)}/send_to_production.json`,
      { method: 'POST', headers: { 'idempotency-key': input.idempotencyKey } },
    );
  }

  async getOrderStatus(input: { externalOrderId: string }): Promise<FulfillmentStatus> {
    const response = await this.request<Record<string, unknown>>(
      `/shops/${encodeURIComponent(this.options.shopId)}/orders/${encodeURIComponent(input.externalOrderId)}.json`,
    );
    return {
      externalOrderId: input.externalOrderId,
      state: stringValue(response.status) ?? 'UNKNOWN',
      occurredAt: null,
    };
  }

  async verifyWebhook(input: {
    body: string;
    signature: string | null;
  }): Promise<FulfillmentWebhookVerification> {
    if (!this.options.webhookSecret || !input.signature) {
      return { valid: false, externalEventId: null, eventName: 'unknown', normalizedPayload: {} };
    }
    const expected = createHmac('sha256', this.options.webhookSecret)
      .update(input.body)
      .digest('hex');
    const valid = safeEqual(expected, input.signature);
    if (!valid)
      return { valid: false, externalEventId: null, eventName: 'unknown', normalizedPayload: {} };
    const parsed = parseWebhook(input.body);
    const resource = recordValue(parsed.resource);
    const order = recordValue(parsed.order);
    return {
      valid: true,
      externalEventId: stringValue(parsed.id) ?? null,
      eventName: stringValue(parsed.type) ?? 'unknown',
      normalizedPayload: {
        orderId: stringValue(resource.id) ?? stringValue(order.id) ?? null,
        status: stringValue(resource.status) ?? stringValue(order.status) ?? null,
      },
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.options.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.options.apiToken}`,
          'content-type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw new FulfillmentIntegrationError('NETWORK_ERROR', 'Printify could not be reached.', {
        cause: error,
      });
    }
    if (!response.ok) throw responseError(response.status);
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new FulfillmentIntegrationError(
        'INVALID_RESPONSE',
        'Printify returned an invalid response.',
        {
          cause: error,
        },
      );
    }
  }
}

/** Deterministic, deliberately non-production catalog used in local development and CI. */
export class FakePrintifyFulfillmentAdapter implements FulfillmentService {
  private readonly orders = new Map<
    string,
    'CREATED' | 'SUBMITTED' | 'IN_PRODUCTION' | 'SHIPPED' | 'DELIVERED'
  >();
  async syncCatalog(input: {
    externalBlueprintIds: string[];
  }): Promise<FulfillmentCatalogSnapshot> {
    return {
      observedAt: new Date('2026-01-01T00:00:00.000Z'),
      blueprints: input.externalBlueprintIds.map((externalBlueprintId) => ({
        externalBlueprintId,
        displayName: 'Essential DTG T-Shirt (development)',
        available: externalBlueprintId === 'fake-essential-dtg-tee-blueprint',
        providers: fakeProviders(),
      })),
    };
  }

  async quoteShipping(input: ShippingQuoteRequest): Promise<NormalizedShippingQuote> {
    const provider = fakeProviders().find(
      (candidate) => candidate.externalProviderId === input.externalProviderId,
    );
    if (
      !provider?.available ||
      !provider.capabilities.destinationCountries.includes(input.destinationCountry)
    ) {
      throw new FulfillmentIntegrationError(
        input.destinationCountry === 'US' ? 'SHIPPING_UNAVAILABLE' : 'DESTINATION_UNSUPPORTED',
        'Shipping is unavailable for this provider and destination.',
      );
    }
    const variant = provider.variants.find(
      (candidate) => candidate.externalVariantId === input.externalVariantId,
    );
    if (!variant?.available) {
      throw new FulfillmentIntegrationError(
        'VARIANT_UNAVAILABLE',
        'The selected shirt option is unavailable.',
      );
    }
    const summit = provider.externalProviderId === 'fake-summit';
    return {
      method: summit ? 'Priority' : 'Standard',
      shippingCents: summit ? 725 : 550,
      currency: 'USD',
      estimatedDeliveryMinDays: summit ? 3 : 5,
      estimatedDeliveryMaxDays: summit ? 5 : 8,
      estimateKind: 'ESTIMATE',
      expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    };
  }

  async createOrder(input: FulfillmentOrderRequest): Promise<FulfillmentOrderResult> {
    const externalOrderId = `fake-order-${input.idempotencyKey}`;
    this.orders.set(externalOrderId, this.orders.get(externalOrderId) ?? 'CREATED');
    return {
      externalOrderId,
      state: this.orders.get(externalOrderId) === 'SUBMITTED' ? 'SUBMITTED' : 'CREATED',
    };
  }

  async submitProduction(input: {
    idempotencyKey: string;
    externalOrderId: string;
  }): Promise<void> {
    void input.idempotencyKey;
    if (!this.orders.has(input.externalOrderId)) {
      throw new FulfillmentIntegrationError(
        'INVALID_RESPONSE',
        'The fake external order is unavailable.',
        {
          retryable: false,
        },
      );
    }
    this.orders.set(input.externalOrderId, 'SUBMITTED');
  }

  async getOrderStatus(input: { externalOrderId: string }): Promise<FulfillmentStatus> {
    return {
      externalOrderId: input.externalOrderId,
      state: this.orders.get(input.externalOrderId) ?? 'UNKNOWN',
      occurredAt: null,
    };
  }

  async verifyWebhook(input: {
    body: string;
    signature: string | null;
  }): Promise<FulfillmentWebhookVerification> {
    const parsed = parseWebhook(input.body);
    return {
      valid: input.signature === 'fake-valid-signature',
      externalEventId: stringValue(parsed.id) ?? null,
      eventName: stringValue(parsed.type) ?? 'unknown',
      normalizedPayload: { status: stringValue(parsed.status) ?? null },
    };
  }
}

function fakeProviders() {
  const variants = colorsAndSizes().map(({ color, size }) => ({
    externalVariantId: `fake-essential-dtg-tee-${color}-${size}`,
    available: !(color === 'white' && size === 'XL'),
  }));
  return [
    {
      externalProviderId: 'fake-harbor',
      displayName: 'Harbor Print Co. (development)',
      available: true,
      capabilities: { decorationMethods: ['DTG'], destinationCountries: ['US'] },
      variants,
    },
    {
      externalProviderId: 'fake-summit',
      displayName: 'Summit Apparel (development)',
      available: true,
      capabilities: { decorationMethods: ['DTG'], destinationCountries: ['US', 'CA'] },
      variants: variants.map((variant) => ({
        ...variant,
        available: variant.available && !variant.externalVariantId.endsWith('-navy-S'),
      })),
    },
    {
      externalProviderId: 'fake-atlas',
      displayName: 'Atlas Print Lab (development)',
      available: false,
      capabilities: { decorationMethods: ['DTG'], destinationCountries: ['US'] },
      variants,
    },
  ];
}

function colorsAndSizes() {
  return ['black', 'white', 'navy'].flatMap((color) =>
    ['S', 'M', 'L', 'XL'].map((size) => ({ color, size })),
  );
}

function responseError(status: number): FulfillmentIntegrationError {
  if (status === 401 || status === 403)
    return new FulfillmentIntegrationError(
      'AUTHENTICATION_ERROR',
      'Printify rejected the credentials.',
      { retryable: false },
    );
  if (status === 404)
    return new FulfillmentIntegrationError(
      'PRODUCT_NOT_FOUND',
      'Printify could not find the requested catalog item.',
      { retryable: false },
    );
  if (status === 429)
    return new FulfillmentIntegrationError('RATE_LIMIT', 'Printify rate limited the request.');
  if (status >= 500)
    return new FulfillmentIntegrationError(
      'PROVIDER_ERROR',
      'Printify is temporarily unavailable.',
    );
  return new FulfillmentIntegrationError('INVALID_RESPONSE', 'Printify rejected the request.', {
    retryable: false,
  });
}

function parseWebhook(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function identifierValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function requiredIdentifier(value: unknown, message: string): string {
  const parsed = identifierValue(value);
  if (!parsed)
    throw new FulfillmentIntegrationError('INVALID_RESPONSE', message, { retryable: false });
  return parsed;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cents(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100);
  return 0;
}

function safeEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
