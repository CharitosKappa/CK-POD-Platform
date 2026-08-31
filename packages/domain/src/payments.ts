import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type {
  PaymentIntentRequest,
  PaymentIntentResult,
  PaymentOutcome,
  PaymentService,
  TaxCalculation,
  TaxService,
  VerifiedPaymentEvent,
} from './commerce-contracts';

/** Deterministic local/CI adapter. Its webhook envelope deliberately mirrors the production boundary. */
export class FakePaymentService implements PaymentService {
  async createIntent(input: PaymentIntentRequest): Promise<PaymentIntentResult> {
    return {
      provider: 'FAKE',
      providerPaymentId: `fake_pi_${input.idempotencyKey.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}`,
      clientSecret: `fake_secret_${input.checkoutAttemptId}`,
      status: 'PENDING',
    };
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
      typeof object.amount !== 'number'
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
      currency: object.currency === 'usd' ? 'USD' : 'USD',
      providerFeeCents:
        typeof object.application_fee_amount === 'number' ? object.application_fee_amount : null,
      metadata:
        typeof object.metadata === 'object' && object.metadata
          ? (object.metadata as Record<string, unknown>)
          : {},
    };
  }

  async refund(input: { providerPaymentId: string; amountCents: number; idempotencyKey: string }) {
    return {
      providerRefundId: `fake_re_${input.idempotencyKey.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}`,
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
      'metadata[checkout_attempt_id]': input.checkoutAttemptId,
    });
    const response = await fetch(`${this.baseUrl}/payment_intents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: form,
    });
    if (!response.ok) throw new Error('Stripe could not prepare payment.');
    const parsed = (await response.json()) as { id: string; client_secret: string; status: string };
    return {
      provider: 'STRIPE',
      providerPaymentId: parsed.id,
      clientSecret: parsed.client_secret,
      status: stripeOutcome(parsed.status),
    };
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
      typeof object.amount !== 'number'
    )
      return null;
    return {
      provider: 'STRIPE',
      providerEventId: parsed.id,
      eventName: parsed.type,
      paymentId: object.id,
      outcome,
      amountCents: object.amount,
      currency: object.currency === 'usd' ? 'USD' : 'USD',
      providerFeeCents: null,
      metadata:
        typeof object.metadata === 'object' && object.metadata
          ? (object.metadata as Record<string, unknown>)
          : {},
    };
  }

  async refund(input: { providerPaymentId: string; amountCents: number; idempotencyKey: string }) {
    const form = new URLSearchParams({
      payment_intent: input.providerPaymentId,
      amount: String(input.amountCents),
    });
    const response = await fetch(`${this.baseUrl}/refunds`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: form,
    });
    if (!response.ok) throw new Error('Stripe could not process the refund.');
    const result = (await response.json()) as { id: string };
    return { providerRefundId: result.id };
  }
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
