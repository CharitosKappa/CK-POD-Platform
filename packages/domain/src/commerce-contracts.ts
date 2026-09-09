/** Platform-owned payment and tax vocabulary. Provider payloads do not cross this boundary. */
export type PaymentAdapter = 'FAKE' | 'STRIPE';

export type PaymentOutcome = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

/** A validated postal identity used for billing and payment-provider AVS boundaries. */
export interface BillingAddress {
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  countryCode: string;
}

export interface PaymentIntentRequest {
  checkoutAttemptId: string;
  amountCents: number;
  currency: 'USD';
  idempotencyKey: string;
  customerEmail: string;
  billingAddress: BillingAddress;
}

export interface PaymentIntentResult {
  provider: PaymentAdapter;
  providerPaymentId: string;
  clientSecret: string | null;
  status: PaymentOutcome;
}

export interface VerifiedPaymentEvent {
  provider: PaymentAdapter;
  providerEventId: string;
  eventName: string;
  paymentId: string;
  outcome: PaymentOutcome;
  amountCents: number;
  currency: 'USD';
  providerFeeCents: number | null;
  metadata: Record<string, unknown>;
}

export interface PaymentService {
  createIntent(input: PaymentIntentRequest): Promise<PaymentIntentResult>;
  verifyWebhook(input: {
    body: string;
    signature: string | null;
  }): Promise<VerifiedPaymentEvent | null>;
  refund(input: {
    providerPaymentId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<{ providerRefundId: string }>;
}

export interface TaxAddress {
  countryCode: string;
  stateCode: string;
  postalCode: string;
}

export interface TaxCalculation {
  provider: 'FAKE' | 'STRIPE_TAX';
  providerCalculationId: string | null;
  taxableSubtotalCents: number;
  shippingTaxCents: number;
  taxCents: number;
  currency: 'USD';
  calculatedAt: Date;
  configurationVersion: string;
}

export interface TaxService {
  calculate(input: {
    subtotalCents: number;
    customerShippingCents: number;
    address: TaxAddress;
  }): Promise<TaxCalculation>;
}
