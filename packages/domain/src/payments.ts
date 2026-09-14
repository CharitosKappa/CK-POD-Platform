import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  PaymentIntentRejectedError,
  PaymentIntentUncertainError,
  PaymentRefundRejectedError,
  PaymentRefundUncertainError,
} from './commerce-contracts';

import type {
  PaymentIntentRequest,
  PaymentIntentResult,
  PaymentOutcome,
  PaymentRefundResult,
  PaymentRefundSubmissionResult,
  PaymentService,
  TaxCalculation,
  TaxService,
  VerifiedPaymentEvent,
} from './commerce-contracts';

/** Deterministic local/CI adapter. Its webhook envelope deliberately mirrors the production boundary. */
export class FakePaymentService implements PaymentService {
  async createIntent(input: PaymentIntentRequest): Promise<PaymentIntentResult> {
    const referenceId =
      input.reference.kind === 'CHECKOUT'
        ? input.reference.checkoutAttemptId
        : input.reference.orderEditPaymentAttemptId;
    return {
      provider: 'FAKE',
      providerPaymentId: `fake_pi_${input.idempotencyKey.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}`,
      clientSecret: `fake_secret_${referenceId}`,
      status: 'PENDING',
    };
  }

  async getIntent(input: {
    providerPaymentId: string;
    request: PaymentIntentRequest;
  }): Promise<PaymentIntentResult> {
    return fakeIntent(input.request, input.providerPaymentId);
  }

  async findIntent(input: PaymentIntentRequest): Promise<PaymentIntentResult> {
    return fakeIntent(input);
  }

  async verifyWebhook(input: {
    body: string;
    signature: string | null;
  }): Promise<VerifiedPaymentEvent | null> {
    if (input.signature !== 'fake-payment-signature') return null;
    const parsed = JSON.parse(input.body) as {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    const object = parsed.data?.object ?? {};
    const outcome = fakeOutcome(parsed.type);
    if (
      !parsed.id ||
      !outcome ||
      typeof object.id !== 'string' ||
      typeof object.amount !== 'number' ||
      object.currency !== 'usd'
    ) {
      return null;
    }
    return {
      provider: 'FAKE',
      providerEventId: parsed.id,
      eventName: parsed.type ?? 'unknown',
      paymentId: object.id,
      outcome,
      amountCents: object.amount,
      currency: 'USD',
      providerFeeCents:
        typeof object.application_fee_amount === 'number' ? object.application_fee_amount : null,
      metadata: paymentMetadata(object, 'card'),
    };
  }

  async refund(input: { providerPaymentId: string; amountCents: number; idempotencyKey: string }) {
    return {
      providerRefundId: `fake_re_${input.idempotencyKey.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}`,
      status: 'SUCCEEDED' as const,
      providerStatus: 'succeeded' as const,
    };
  }

  async getRefundStatus(input: {
    providerRefundId: string;
    providerPaymentId: string;
    amountCents: number;
  }): Promise<PaymentRefundResult> {
    return {
      providerRefundId: input.providerRefundId,
      status: 'SUCCEEDED',
      providerStatus: 'succeeded',
    };
  }
}

/** Minimal Stripe PaymentIntent adapter. Browser payment details stay in Stripe Elements/tokenized flows. */
export class StripePaymentService implements PaymentService {
  public constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly baseUrl = 'https://api.stripe.com/v1',
  ) {}

  async createIntent(input: PaymentIntentRequest): Promise<PaymentIntentResult> {
    const form = new URLSearchParams({
      amount: String(input.amountCents),
      currency: 'usd',
      'automatic_payment_methods[enabled]': 'true',
      receipt_email: input.customerEmail,
      ...paymentIntentMetadata(input),
    });
    let response: Response;
    let parsed: Record<string, unknown>;
    try {
      response = await fetch(`${this.baseUrl}/payment_intents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': input.idempotencyKey,
        },
        body: form,
      });
      parsed = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new PaymentIntentUncertainError();
    }
    if (!response.ok) {
      const error = parsed.error as { type?: unknown } | undefined;
      const definitive = new Map<number, string[]>([
        [400, ['invalid_request_error']],
        [401, ['authentication_error']],
        [402, ['card_error']],
        [403, ['permission_error']],
        [404, ['invalid_request_error']],
      ]);
      if (typeof error?.type === 'string' && definitive.get(response.status)?.includes(error.type))
        throw new PaymentIntentRejectedError();
      throw new PaymentIntentUncertainError();
    }
    return stripeIntentResult(parsed, input);
  }

  async getIntent(input: {
    providerPaymentId: string;
    request: PaymentIntentRequest;
  }): Promise<PaymentIntentResult> {
    let response: Response;
    let result: Record<string, unknown>;
    try {
      response = await fetch(
        `${this.baseUrl}/payment_intents/${encodeURIComponent(input.providerPaymentId)}`,
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      );
      result = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new PaymentIntentUncertainError();
    } catch {
      throw new PaymentIntentUncertainError();
    }
    return stripeIntentResult(result, input.request);
  }

  async findIntent(input: PaymentIntentRequest): Promise<PaymentIntentResult | null> {
    if (input.reference.kind !== 'ORDER_EDIT') throw new PaymentIntentUncertainError();
    const query = new URLSearchParams({
      query: `metadata['order_edit_payment_attempt_id']:'${input.reference.orderEditPaymentAttemptId}'`,
    });
    let response: Response;
    let result: Record<string, unknown>;
    try {
      response = await fetch(`${this.baseUrl}/payment_intents/search?${query}`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
      });
      result = (await response.json()) as Record<string, unknown>;
      if (!response.ok || !Array.isArray(result.data)) throw new PaymentIntentUncertainError();
    } catch {
      throw new PaymentIntentUncertainError();
    }
    if (result.data.length === 0) return null;
    if (result.data.length !== 1) throw new PaymentIntentUncertainError();
    return stripeIntentResult(result.data[0] as Record<string, unknown>, input);
  }

  async verifyWebhook(input: {
    body: string;
    signature: string | null;
  }): Promise<VerifiedPaymentEvent | null> {
    if (!input.signature || !verifyStripeSignature(input.body, input.signature, this.webhookSecret))
      return null;
    const parsed = JSON.parse(input.body) as {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    const object = parsed.data?.object ?? {};
    const outcome = stripeEventOutcome(parsed.type);
    if (
      !parsed.id ||
      !parsed.type ||
      !outcome ||
      typeof object.id !== 'string' ||
      typeof object.amount !== 'number' ||
      object.currency !== 'usd'
    )
      return null;
    return {
      provider: 'STRIPE',
      providerEventId: parsed.id,
      eventName: parsed.type,
      paymentId: object.id,
      outcome,
      amountCents: object.amount,
      currency: 'USD',
      providerFeeCents: null,
      metadata: paymentMetadata(object),
    };
  }

  async refund(input: { providerPaymentId: string; amountCents: number; idempotencyKey: string }) {
    const form = new URLSearchParams({
      payment_intent: input.providerPaymentId,
      amount: String(input.amountCents),
      'metadata[platform_refund_key]': input.idempotencyKey,
    });
    let response: Response;
    let result: Record<string, unknown>;
    try {
      response = await fetch(`${this.baseUrl}/refunds`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': input.idempotencyKey,
        },
        body: form,
      });
      result = (await response.json()) as Record<string, unknown>;
      if (!result || typeof result !== 'object') throw new PaymentRefundUncertainError();
    } catch {
      throw new PaymentRefundUncertainError();
    }
    if (!response.ok) {
      const error = result.error as { type?: unknown } | undefined;
      // Timeouts, 5xx, rate limiting and idempotency conflicts can follow a remote
      // side effect. Only an explicit validation/auth/card refusal is definitive.
      const refusalType = new Map<number, string[]>([
        [400, ['invalid_request_error']],
        [401, ['authentication_error']],
        [402, ['card_error']],
        [403, ['permission_error']],
        [404, ['invalid_request_error']],
      ]);
      if (typeof error?.type === 'string' && refusalType.get(response.status)?.includes(error.type))
        throw new PaymentRefundRejectedError();
      throw new PaymentRefundUncertainError();
    }
    const refund = stripeRefundResult(result, input);
    if (refund.status === 'FAILED') throw new PaymentRefundRejectedError();
    return refund as PaymentRefundSubmissionResult;
  }

  async getRefundStatus(input: {
    providerRefundId: string;
    providerPaymentId: string;
    amountCents: number;
  }): Promise<PaymentRefundResult> {
    let response: Response;
    let result: Record<string, unknown>;
    try {
      response = await fetch(
        `${this.baseUrl}/refunds/${encodeURIComponent(input.providerRefundId)}`,
        {
          headers: { Authorization: `Bearer ${this.secretKey}` },
        },
      );
      result = (await response.json()) as Record<string, unknown>;
      if (!response.ok || !result || typeof result !== 'object')
        throw new PaymentRefundUncertainError();
    } catch {
      throw new PaymentRefundUncertainError();
    }
    return stripeRefundResult(result, input);
  }

  async findRefund(input: {
    providerPaymentId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<PaymentRefundResult | null> {
    let startingAfter: string | undefined;
    for (;;) {
      const query = new URLSearchParams({
        payment_intent: input.providerPaymentId,
        limit: '100',
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      let response: Response;
      let result: Record<string, unknown>;
      try {
        response = await fetch(`${this.baseUrl}/refunds?${query}`, {
          headers: { Authorization: `Bearer ${this.secretKey}` },
        });
        result = (await response.json()) as Record<string, unknown>;
        if (!response.ok || !result || typeof result !== 'object' || !Array.isArray(result.data))
          throw new PaymentRefundUncertainError();
      } catch {
        throw new PaymentRefundUncertainError();
      }
      const matches = result.data.filter((entry): entry is Record<string, unknown> => {
        if (!entry || typeof entry !== 'object') return false;
        const metadata = (entry as Record<string, unknown>).metadata;
        return (
          !!metadata &&
          typeof metadata === 'object' &&
          (metadata as Record<string, unknown>).platform_refund_key === input.idempotencyKey
        );
      });
      if (matches.length > 1) throw new PaymentRefundUncertainError();
      if (matches[0]) return stripeRefundResult(matches[0], input);
      if (result.has_more !== true) return null;
      const last = result.data.at(-1) as Record<string, unknown> | undefined;
      if (!last || typeof last.id !== 'string' || !last.id.startsWith('re_'))
        throw new PaymentRefundUncertainError();
      startingAfter = last.id;
    }
  }
}

function paymentIntentMetadata(input: PaymentIntentRequest): Record<string, string> {
  if (input.reference.kind === 'CHECKOUT')
    return {
      'metadata[payment_reference_kind]': 'CHECKOUT',
      'metadata[checkout_attempt_id]': input.reference.checkoutAttemptId,
    };
  return {
    'metadata[payment_reference_kind]': 'ORDER_EDIT',
    'metadata[order_id]': input.reference.orderId,
    'metadata[order_revision_id]': input.reference.orderRevisionId,
    'metadata[order_edit_payment_attempt_id]': input.reference.orderEditPaymentAttemptId,
  };
}

function fakeIntent(input: PaymentIntentRequest, providerPaymentId?: string): PaymentIntentResult {
  const referenceId =
    input.reference.kind === 'CHECKOUT'
      ? input.reference.checkoutAttemptId
      : input.reference.orderEditPaymentAttemptId;
  return {
    provider: 'FAKE',
    providerPaymentId:
      providerPaymentId ??
      `fake_pi_${input.idempotencyKey.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}`,
    clientSecret: `fake_secret_${referenceId}`,
    status: 'PENDING',
  };
}

function stripeIntentResult(
  value: Record<string, unknown>,
  expected: PaymentIntentRequest,
): PaymentIntentResult {
  const metadata =
    value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
      ? (value.metadata as Record<string, unknown>)
      : {};
  const expectedMetadata = Object.fromEntries(
    Object.entries(paymentIntentMetadata(expected)).map(([key, field]) => [
      key.slice('metadata['.length, -1),
      field,
    ]),
  );
  if (
    typeof value.id !== 'string' ||
    typeof value.status !== 'string' ||
    value.amount !== expected.amountCents ||
    value.currency !== 'usd' ||
    Object.entries(expectedMetadata).some(([key, field]) => metadata[key] !== field)
  )
    throw new PaymentIntentUncertainError();
  return {
    provider: 'STRIPE',
    providerPaymentId: value.id,
    clientSecret: typeof value.client_secret === 'string' ? value.client_secret : null,
    status: stripeOutcome(value.status),
  };
}

function stripeRefundResult(
  result: Record<string, unknown>,
  expected: { providerRefundId?: string; providerPaymentId: string; amountCents: number },
): PaymentRefundResult {
  if (
    typeof result.id !== 'string' ||
    !result.id.startsWith('re_') ||
    (expected.providerRefundId !== undefined && result.id !== expected.providerRefundId) ||
    result.payment_intent !== expected.providerPaymentId ||
    result.amount !== expected.amountCents ||
    !['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(
      String(result.status),
    )
  )
    throw new PaymentRefundUncertainError();
  const providerStatus = result.status as PaymentRefundResult['providerStatus'];
  return {
    providerRefundId: result.id,
    status:
      providerStatus === 'succeeded'
        ? 'SUCCEEDED'
        : providerStatus === 'failed' || providerStatus === 'canceled'
          ? 'FAILED'
          : 'PENDING',
    providerStatus,
  };
}

/** Development tax only. Production tax policy remains gated by G4. */
export class FakeTaxService implements TaxService {
  public constructor(
    private readonly rateBasisPoints = 0,
    private readonly version = 'development-tax-v1',
  ) {}

  async calculate(input: {
    subtotalCents: number;
    customerShippingCents: number;
    address: { countryCode: string; stateCode: string; postalCode: string };
  }): Promise<TaxCalculation> {
    const taxableSubtotalCents = input.subtotalCents;
    const taxCents = Math.round((taxableSubtotalCents * this.rateBasisPoints) / 10_000);
    return {
      provider: 'FAKE',
      providerCalculationId: `fake_tax_${randomUUID()}`,
      taxableSubtotalCents,
      shippingTaxCents: 0,
      taxCents,
      currency: 'USD',
      calculatedAt: new Date(),
      configurationVersion: this.version,
    };
  }
}

/** Optional Stripe Tax adapter. Tax registration and nexus policy remain external G4 configuration. */
export class StripeTaxService implements TaxService {
  public constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.stripe.com/v1',
  ) {}

  async calculate(input: {
    subtotalCents: number;
    customerShippingCents: number;
    address: { countryCode: string; stateCode: string; postalCode: string };
  }): Promise<TaxCalculation> {
    const form = new URLSearchParams({
      currency: 'usd',
      'customer_details[address][country]': input.address.countryCode,
      'customer_details[address][state]': input.address.stateCode,
      'customer_details[address][postal_code]': input.address.postalCode,
      'line_items[0][amount]': String(input.subtotalCents),
      'line_items[0][reference]': 'platform-retail-items',
      'line_items[1][amount]': String(input.customerShippingCents),
      'line_items[1][reference]': 'customer-shipping',
    });
    const response = await fetch(`${this.baseUrl}/tax/calculations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    if (!response.ok) throw new Error('Tax calculation could not be completed.');
    const result = (await response.json()) as {
      id: string;
      tax_amount_exclusive?: number;
      tax_breakdown?: Array<{ amount?: number }>;
    };
    const taxCents =
      result.tax_amount_exclusive ??
      result.tax_breakdown?.reduce((sum, entry) => sum + (entry.amount ?? 0), 0) ??
      0;
    return {
      provider: 'STRIPE_TAX',
      providerCalculationId: result.id,
      taxableSubtotalCents: input.subtotalCents,
      shippingTaxCents: 0,
      taxCents,
      currency: 'USD',
      calculatedAt: new Date(),
      configurationVersion: 'stripe-tax-configured',
    };
  }
}

function fakeOutcome(eventName: string | undefined): PaymentOutcome | null {
  if (eventName === 'payment_intent.succeeded') return 'SUCCEEDED';
  if (eventName === 'payment_intent.payment_failed') return 'FAILED';
  if (eventName === 'payment_intent.canceled') return 'CANCELLED';
  if (eventName === 'payment_intent.processing') return 'PENDING';
  return null;
}

function paymentMetadata(
  object: Record<string, unknown>,
  fallbackMethodType?: string,
): Record<string, unknown> {
  const metadata =
    typeof object.metadata === 'object' && object.metadata && !Array.isArray(object.metadata)
      ? { ...(object.metadata as Record<string, unknown>) }
      : {};
  const providerMethodTypes = Array.isArray(object.payment_method_types)
    ? object.payment_method_types.filter((value): value is string => typeof value === 'string')
    : [];
  const paymentMethodType = providerMethodTypes[0] ?? fallbackMethodType;
  return paymentMethodType ? { ...metadata, paymentMethodType } : metadata;
}

function stripeEventOutcome(eventName: string | undefined): PaymentOutcome | null {
  return fakeOutcome(eventName);
}

function stripeOutcome(status: string): PaymentOutcome {
  if (status === 'succeeded') return 'SUCCEEDED';
  if (status === 'canceled') return 'CANCELLED';
  if (status === 'requires_payment_method' || status === 'requires_action') return 'PENDING';
  return 'PENDING';
}

function verifyStripeSignature(body: string, signature: string, secret: string): boolean {
  const timestamp = signature.match(/(?:^|,)t=(\d+)/)?.[1];
  const supplied = signature.match(/(?:^|,)v1=([a-f0-9]+)/)?.[1];
  if (!timestamp || !supplied) return false;
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}
