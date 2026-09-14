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

export type PaymentIntentReference =
  | { kind: 'CHECKOUT'; checkoutAttemptId: string }
  | {
      kind: 'ORDER_EDIT';
      orderId: string;
      orderRevisionId: string;
      orderEditPaymentAttemptId: string;
    };

export interface PaymentIntentRequest {
  reference: PaymentIntentReference;
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

/** Only a definitive provider refusal can release a reserved refund amount. */
export class PaymentRefundRejectedError extends Error {
  constructor() {
    super('Stripe could not process the refund.');
  }
}

/** An uncertain external result must keep its durable reservation until reconciled. */
export class PaymentRefundUncertainError extends Error {
  constructor() {
    super(
      'Refund outcome is not confirmed. Check the existing refund before taking another action.',
    );
  }
}

export type PaymentRefundStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface PaymentRefundResult {
  providerRefundId: string;
  status: PaymentRefundStatus;
  providerStatus: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';
}

export type PaymentRefundSubmissionResult = Omit<
  PaymentRefundResult,
  'status' | 'providerStatus'
> & {
  status: 'PENDING' | 'SUCCEEDED';
  providerStatus: 'pending' | 'requires_action' | 'succeeded';
};

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
  }): Promise<PaymentRefundSubmissionResult>;
  /** Safe read-only reconciliation for an accepted nonterminal provider refund. */
  getRefundStatus?(input: {
    providerRefundId: string;
    providerPaymentId: string;
    amountCents: number;
  }): Promise<PaymentRefundResult>;
  /** Finds the accepted refund after provider success preceded the first local ID write. */
  findRefund?(input: {
    providerPaymentId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<PaymentRefundResult | null>;
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
