import { describe, expect, it } from 'vitest';

import {
  calculateProductionEconomics,
  OrderDetailDataError,
  parseOrderPricingSnapshot,
  parsePostalAddressSnapshot,
} from './order-detail.js';

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
});
