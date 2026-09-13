import { describe, expect, it } from 'vitest';

import {
  aggregatePrintingState,
  projectFulfillmentState,
  projectPaymentState,
} from './order-detail-contracts.js';

describe('order detail state projections', () => {
  it.each([
    [{ paymentStatus: 'PENDING', paidCents: 0, refundedCents: 0 }, 'PENDING'],
    [{ paymentStatus: 'SUCCEEDED', paidCents: 9306, refundedCents: 0 }, 'PAID'],
    [{ paymentStatus: 'SUCCEEDED', paidCents: 9306, refundedCents: 3000 }, 'PARTIALLY_REFUNDED'],
    [{ paymentStatus: 'SUCCEEDED', paidCents: 9306, refundedCents: 9306 }, 'REFUNDED'],
    [{ paymentStatus: 'FAILED', paidCents: 0, refundedCents: 0 }, 'FAILED'],
    [{ paymentStatus: 'CANCELLED', paidCents: 0, refundedCents: 0 }, 'CANCELLED'],
    [{ paymentStatus: null, paidCents: 0, refundedCents: 0 }, 'PENDING'],
  ] as const)('projects payment evidence to %s', (input, expected) => {
    expect(projectPaymentState(input)).toBe(expected);
  });

  it('caps excessive refund evidence at refunded', () => {
    expect(
      projectPaymentState({ paymentStatus: 'SUCCEEDED', paidCents: 9306, refundedCents: 10_000 }),
    ).toBe('REFUNDED');
  });

  it.each([
    [[], 'NOT_STARTED'],
    [['PRINTED'], 'PRINTED'],
    [['IN_PRODUCTION', 'SUBMITTED'], 'PARTIALLY_IN_PRODUCTION'],
    [['PRINTED', 'IN_PRODUCTION'], 'PARTIALLY_PRINTED'],
    [['FAILED', 'SUBMITTED'], 'NEEDS_ATTENTION'],
    [['ON_HOLD'], 'NEEDS_ATTENTION'],
    [['CANCELLED', 'CANCELLED'], 'CANCELLED'],
  ] as const)('aggregates printing groups %#', (states, expected) => {
    expect(aggregatePrintingState([...states])).toBe(expected);
  });

  it.each([
    [
      { totalQuantity: 2, fulfilledQuantity: 0, deliveredQuantity: 0, cancelledQuantity: 0 },
      'UNFULFILLED',
    ],
    [
      { totalQuantity: 2, fulfilledQuantity: 1, deliveredQuantity: 0, cancelledQuantity: 0 },
      'PARTIALLY_FULFILLED',
    ],
    [
      { totalQuantity: 2, fulfilledQuantity: 2, deliveredQuantity: 0, cancelledQuantity: 0 },
      'FULFILLED',
    ],
    [
      { totalQuantity: 2, fulfilledQuantity: 2, deliveredQuantity: 2, cancelledQuantity: 0 },
      'DELIVERED',
    ],
    [
      { totalQuantity: 2, fulfilledQuantity: 0, deliveredQuantity: 0, cancelledQuantity: 2 },
      'CANCELLED',
    ],
  ] as const)('projects fulfillment quantities %#', (input, expected) => {
    expect(projectFulfillmentState(input)).toBe(expected);
  });

  it('keeps printed and unfulfilled as a valid combination', () => {
    expect(aggregatePrintingState(['PRINTED'])).toBe('PRINTED');
    expect(
      projectFulfillmentState({
        totalQuantity: 2,
        fulfilledQuantity: 0,
        deliveredQuantity: 0,
        cancelledQuantity: 0,
      }),
    ).toBe('UNFULFILLED');
  });

  it('rejects impossible fulfillment quantities', () => {
    expect(() =>
      projectFulfillmentState({
        totalQuantity: 1,
        fulfilledQuantity: 2,
        deliveredQuantity: 0,
        cancelledQuantity: 0,
      }),
    ).toThrow('Fulfillment quantities are inconsistent.');
  });
});
