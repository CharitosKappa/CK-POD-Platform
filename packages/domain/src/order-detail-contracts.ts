export const paymentStates = [
  'PENDING',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FAILED',
  'CANCELLED',
] as const;

export type PaymentState = (typeof paymentStates)[number];

export const printingGroupStates = [
  'NOT_STARTED',
  'PREPRESS_REVIEW',
  'COMPLIANCE_REVIEW',
  'READY_FOR_PRODUCTION',
  'SUBMITTING',
  'SUBMITTED',
  'IN_PRODUCTION',
  'PRINTED',
  'ON_HOLD',
  'FAILED',
  'CANCELLED',
] as const;

export type PrintingGroupState = (typeof printingGroupStates)[number];

export type OrderPrintingState =
  | PrintingGroupState
  | 'PARTIALLY_IN_PRODUCTION'
  | 'PARTIALLY_PRINTED'
  | 'NEEDS_ATTENTION';

export type FulfillmentState =
  | 'UNFULFILLED'
  | 'PARTIALLY_FULFILLED'
  | 'FULFILLED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface PaymentStateEvidence {
  paymentStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | null;
  paidCents: number;
  refundedCents: number;
}

export interface FulfillmentStateEvidence {
  totalQuantity: number;
  fulfilledQuantity: number;
  deliveredQuantity: number;
  cancelledQuantity: number;
}

export function projectPaymentState(input: PaymentStateEvidence): PaymentState {
  if (input.paymentStatus === 'FAILED') return 'FAILED';
  if (input.paymentStatus === 'CANCELLED') return 'CANCELLED';
  if (input.paymentStatus !== 'SUCCEEDED') return 'PENDING';
  if (input.paidCents > 0 && input.refundedCents >= input.paidCents) return 'REFUNDED';
  if (input.refundedCents > 0) return 'PARTIALLY_REFUNDED';
  return 'PAID';
}

export function aggregatePrintingState(states: PrintingGroupState[]): OrderPrintingState {
  if (states.length === 0) return 'NOT_STARTED';
  if (states.every((state) => state === 'CANCELLED')) return 'CANCELLED';
  if (states.some((state) => state === 'FAILED' || state === 'ON_HOLD')) {
    return 'NEEDS_ATTENTION';
  }

  const first = states[0]!;
  if (states.every((state) => state === first)) return first;
  if (states.includes('PRINTED')) return 'PARTIALLY_PRINTED';
  if (states.some((state) => state === 'IN_PRODUCTION' || state === 'SUBMITTED')) {
    return 'PARTIALLY_IN_PRODUCTION';
  }

  const progress: PrintingGroupState[] = [
    'NOT_STARTED',
    'PREPRESS_REVIEW',
    'COMPLIANCE_REVIEW',
    'READY_FOR_PRODUCTION',
    'SUBMITTING',
  ];
  return states.reduce((mostAdvanced, state) =>
    progress.indexOf(state) > progress.indexOf(mostAdvanced) ? state : mostAdvanced,
  );
}

export function projectFulfillmentState(input: FulfillmentStateEvidence): FulfillmentState {
  const quantities = [
    input.totalQuantity,
    input.fulfilledQuantity,
    input.deliveredQuantity,
    input.cancelledQuantity,
  ];
  const inconsistent =
    quantities.some((quantity) => !Number.isInteger(quantity) || quantity < 0) ||
    input.fulfilledQuantity > input.totalQuantity ||
    input.deliveredQuantity > input.fulfilledQuantity ||
    input.cancelledQuantity > input.totalQuantity ||
    input.fulfilledQuantity + input.cancelledQuantity > input.totalQuantity;
  if (inconsistent) throw new Error('Fulfillment quantities are inconsistent.');

  if (input.totalQuantity > 0 && input.cancelledQuantity === input.totalQuantity) {
    return 'CANCELLED';
  }
  const activeQuantity = input.totalQuantity - input.cancelledQuantity;
  if (activeQuantity > 0 && input.deliveredQuantity === activeQuantity) return 'DELIVERED';
  if (activeQuantity > 0 && input.fulfilledQuantity === activeQuantity) return 'FULFILLED';
  if (input.fulfilledQuantity > 0 || input.deliveredQuantity > 0) return 'PARTIALLY_FULFILLED';
  return 'UNFULFILLED';
}
