/**
 * Platform-owned fulfillment vocabulary. Printify is one implementation detail
 * of this contract; no consumer or routing code receives raw provider payloads.
 */
export type FulfillmentAdapterType = 'PRINTIFY';

export type FulfillmentErrorCode =
  | 'AUTHENTICATION_ERROR'
  | 'RATE_LIMIT'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'PRODUCT_NOT_FOUND'
  | 'PROVIDER_NOT_FOUND'
  | 'VARIANT_UNAVAILABLE'
  | 'SHIPPING_UNAVAILABLE'
  | 'DESTINATION_UNSUPPORTED'
  | 'INVALID_ARTWORK'
  | 'PROVIDER_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'UNKNOWN';

const retryableErrors = new Set<FulfillmentErrorCode>([
  'RATE_LIMIT',
  'NETWORK_ERROR',
  'TIMEOUT',
  'PROVIDER_ERROR',
]);

export class FulfillmentIntegrationError extends Error {
  public readonly retryable: boolean;

  public constructor(
    public readonly code: FulfillmentErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = 'FulfillmentIntegrationError';
    this.retryable = options.retryable ?? retryableErrors.has(code);
  }
}

export interface ExternalVariantAvailability {
  externalVariantId: string;
  available: boolean;
}

export interface ExternalProviderCatalogEntry {
  externalProviderId: string;
  displayName: string;
  available: boolean;
  capabilities: { decorationMethods: string[]; destinationCountries: string[] };
  variants: ExternalVariantAvailability[];
}

export interface ExternalBlueprintCatalogEntry {
  externalBlueprintId: string;
  displayName: string;
  available: boolean;
  providers: ExternalProviderCatalogEntry[];
}

export interface FulfillmentCatalogSnapshot {
  blueprints: ExternalBlueprintCatalogEntry[];
  observedAt: Date;
}

export interface ShippingQuoteRequest {
  externalProviderId: string;
  externalBlueprintId: string;
  externalVariantId: string;
  destinationCountry: string;
}

export interface NormalizedShippingQuote {
  method: string;
  shippingCents: number;
  currency: string;
  estimatedDeliveryMinDays: number | null;
  estimatedDeliveryMaxDays: number | null;
  estimateKind: 'ESTIMATE' | 'PROVIDER_SLA' | 'UNKNOWN';
  expiresAt: Date | null;
}

export interface FulfillmentOrderRequest {
  idempotencyKey: string;
  externalProductId: string;
  items: Array<{ externalVariantId: string; quantity: number; artworkReference: string }>;
}

export interface FulfillmentOrderResult {
  externalOrderId: string;
  state: 'CREATED' | 'SUBMITTED' | 'UNKNOWN';
}

export interface FulfillmentStatus {
  externalOrderId: string;
  state: string;
  occurredAt: Date | null;
}

export interface FulfillmentWebhookVerification {
  valid: boolean;
  externalEventId: string | null;
  eventName: string;
  normalizedPayload: Record<string, unknown>;
}

export interface FulfillmentService {
  syncCatalog(input: { externalBlueprintIds: string[] }): Promise<FulfillmentCatalogSnapshot>;
  quoteShipping(input: ShippingQuoteRequest): Promise<NormalizedShippingQuote>;
  createOrder(input: FulfillmentOrderRequest): Promise<FulfillmentOrderResult>;
  submitProduction(input: { idempotencyKey: string; externalOrderId: string }): Promise<void>;
  getOrderStatus(input: { externalOrderId: string }): Promise<FulfillmentStatus>;
  verifyWebhook(input: {
    body: string;
    signature: string | null;
  }): Promise<FulfillmentWebhookVerification>;
}

export function normalizeFulfillmentError(error: unknown): FulfillmentIntegrationError {
  if (error instanceof FulfillmentIntegrationError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new FulfillmentIntegrationError(
      'TIMEOUT',
      'The fulfillment provider did not respond in time.',
    );
  }
  return new FulfillmentIntegrationError(
    'UNKNOWN',
    'The fulfillment provider could not complete the request.',
    { cause: error },
  );
}
