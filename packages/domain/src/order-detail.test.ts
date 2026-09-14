import { describe, expect, it } from 'vitest';

import {
  calculateProductionEconomics,
  calculateOrderActionBalances,
  filterNonEmptyOrderGroups,
  OrderDetailDataError,
  paymentMethodLabel,
  parseOrderPricingSnapshot,
  parseOrderTaxLines,
  parsePostalAddressSnapshot,
  permittedPrintingActions,
} from './order-detail.js';

describe('order action financial projection', () => {
  it('reserves pending refunds without turning a goodwill refund into edit debt', () => {
    expect(
      calculateOrderActionBalances({
        paidCents: 5000,
        refundedCents: 1000,
        pendingRefundCents: 500,
        amountDueCents: 0,
        refundableAdjustmentCents: 200,
      }),
    ).toEqual({ refundableCents: 3500, amountDueCents: 0, refundableAdjustmentCents: 200 });
  });
  it('preserves the explicit edit balance and clamps an exhausted refund cap', () => {
    expect(
      calculateOrderActionBalances({
        paidCents: 5000,
        refundedCents: 5000,
        pendingRefundCents: 0,
        amountDueCents: 800,
        refundableAdjustmentCents: 0,
      }),
    ).toEqual({ refundableCents: 0, amountDueCents: 800, refundableAdjustmentCents: 0 });
  });
});

describe('order detail snapshot boundary', () => {
  it('accepts the immutable order pricing fields used by the admin projection', () => {
    expect(
      parseOrderPricingSnapshot({
        unitRetailCents: 3999,
        quantity: 2,
        discountCents: 500,
        subtotalCents: 7998,
        customerShippingCents: 750,
        freeShippingApplied: false,
        taxCents: 721,
        totalCents: 8969,
        currency: 'USD',
        pricingVersion: 'v1',
      }),
    ).toMatchObject({ subtotalCents: 7998, discountCents: 500, totalCents: 8969 });
  });

  it('rejects malformed financial snapshots instead of inventing values', () => {
    expect(() => parseOrderPricingSnapshot({ totalCents: '8969', currency: 'USD' })).toThrow(
      OrderDetailDataError,
    );
  });

  it('normalizes a persisted postal-address snapshot', () => {
    expect(
      parsePostalAddressSnapshot({
        recipientName: 'Taylor Davis',
        line1: '123 Palm Avenue',
        line2: null,
        city: 'Miami',
        stateCode: 'FL',
        postalCode: '33130',
        countryCode: 'US',
      }),
    ).toEqual({
      recipientName: 'Taylor Davis',
      line1: '123 Palm Avenue',
      line2: null,
      city: 'Miami',
      stateCode: 'FL',
      postalCode: '33130',
      countryCode: 'US',
    });
  });

  it('calculates frozen provider economics in integer cents', () => {
    expect(
      calculateProductionEconomics({
        retailRevenueCents: 10_000,
        productionCostCents: 4_500,
        providerShippingCostCents: 1_000,
        providerFeesCents: 500,
      }),
    ).toEqual({
      retailRevenueCents: 10_000,
      productionCostCents: 4_500,
      providerShippingCostCents: 1_000,
      providerFeesCents: 500,
      grossMarginCents: 4_000,
      grossMarginBasisPoints: 4_000,
    });
  });

  it('keeps margin unavailable when historical provider costs are unavailable', () => {
    expect(
      calculateProductionEconomics({
        retailRevenueCents: 10_000,
        productionCostCents: null,
        providerShippingCostCents: null,
        providerFeesCents: null,
      }),
    ).toMatchObject({ grossMarginCents: null, grossMarginBasisPoints: null });
  });

  it('builds a state tax line from the persisted tax calculation instead of a hardcoded rate', () => {
    expect(
      parseOrderTaxLines(
        {
          provider: 'STRIPE_TAX',
          providerCalculationId: 'taxcalc_1',
          taxableSubtotalCents: 4000,
          shippingTaxCents: 0,
          taxCents: 290,
          currency: 'USD',
          calculatedAt: '2026-09-13T12:00:00.000Z',
          configurationVersion: 'stripe-tax-configured',
        },
        'CA',
        290,
      ),
    ).toEqual([{ label: 'California Sales Tax', rateBasisPoints: 725, amountCents: 290 }]);
  });

  it('projects the Wyoming delivery jurisdiction with its persisted calculated rate', () => {
    expect(
      parseOrderTaxLines(
        { taxableSubtotalCents: 5000, shippingTaxCents: 0, taxCents: 200 },
        'WY',
        200,
      ),
    ).toEqual([{ label: 'Wyoming Sales Tax', rateBasisPoints: 400, amountCents: 200 }]);
  });

  it('keeps a persisted tax amount visible without inventing a rate when the snapshot is absent', () => {
    expect(parseOrderTaxLines(null, 'CA', 290)).toEqual([
      { label: 'Taxes', rateBasisPoints: null, amountCents: 290 },
    ]);
  });

  it('keeps persisted shipping tax separate from merchandise sales tax', () => {
    expect(
      parseOrderTaxLines(
        { taxableSubtotalCents: 4000, shippingTaxCents: 40, taxCents: 330 },
        'CA',
        330,
      ),
    ).toEqual([
      { label: 'California Sales Tax', rateBasisPoints: 725, amountCents: 290 },
      { label: 'Shipping tax', rateBasisPoints: null, amountCents: 40 },
    ]);
  });

  it('describes the persisted payment composition', () => {
    expect(paymentMethodLabel('FAKE', {})).toBe('Credit card');
    expect(paymentMethodLabel('STRIPE', { paymentMethodType: 'card' })).toBe('Credit card');
    expect(
      paymentMethodLabel('STRIPE', {
        paymentMethodType: 'card',
        storeCreditAmountCents: 1200,
      }),
    ).toBe('Credit card + Store credits');
  });

  it('omits orphan fulfillment groups without assigned items', () => {
    expect(
      filterNonEmptyOrderGroups([
        { id: 'provider-a', itemCount: 1 },
        { id: 'orphan', itemCount: 0 },
      ]),
    ).toEqual([{ id: 'provider-a', itemCount: 1 }]);
  });
});

describe('printing group action permissions', () => {
  const actor = {
    id: 'session-1',
    staffMemberId: 'staff-1',
    email: 'owner@example.test',
    role: 'OWNER' as const,
    expiresAt: new Date('2026-09-13T12:00:00.000Z'),
  };

  it('returns only actions backed by the group-scoped submission mechanism', () => {
    expect(permittedPrintingActions(actor, 'READY_FOR_PRODUCTION')).toEqual(['SUBMIT']);
    expect(permittedPrintingActions(actor, 'FAILED')).toEqual(['RETRY']);
    expect(permittedPrintingActions(actor, 'IN_PRODUCTION')).toEqual([]);
    expect(permittedPrintingActions(actor, 'ON_HOLD')).toEqual([]);
  });

  it('does not expose mutations to read-only staff', () => {
    expect(
      permittedPrintingActions({ ...actor, role: 'READ_ONLY' }, 'READY_FOR_PRODUCTION'),
    ).toEqual([]);
  });
});
