import { describe, expect, it } from 'vitest';

import {
  calculateProductionEconomics,
  OrderDetailDataError,
  parseOrderPricingSnapshot,
  parsePostalAddressSnapshot,
  permittedPrintingActions,
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
