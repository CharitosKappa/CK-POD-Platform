import { describe, expect, it } from 'vitest';

import {
  formatOrderAddress,
  groupTimelineByDate,
  isPrintingAttentionState,
  layerStatusPresentation,
} from './order-detail-format';

describe('admin order detail presentation', () => {
  it.each([
    ['payment', 'PENDING', { label: 'Pending', tone: 'warning' }],
    ['payment', 'PAID', { label: 'Paid', tone: 'success' }],
    ['payment', 'PARTIALLY_REFUNDED', { label: 'Partially refunded', tone: 'warning' }],
    ['printing', 'IN_PRODUCTION', { label: 'In production', tone: 'info' }],
    ['printing', 'NEEDS_ATTENTION', { label: 'Needs attention', tone: 'danger' }],
    ['fulfillment', 'UNFULFILLED', { label: 'Unfulfilled', tone: 'warning' }],
    ['fulfillment', 'DELIVERED', { label: 'Delivered', tone: 'success' }],
  ] as const)('maps %s %s to a literal presentation', (layer, state, expected) => {
    expect(layerStatusPresentation(layer, state)).toEqual(expected);
  });

  it('marks only actionable printing exceptions as attention states', () => {
    expect(isPrintingAttentionState('FAILED')).toBe(true);
    expect(isPrintingAttentionState('ON_HOLD')).toBe(true);
    expect(isPrintingAttentionState('NEEDS_ATTENTION')).toBe(true);
    expect(isPrintingAttentionState('IN_PRODUCTION')).toBe(false);
    expect(isPrintingAttentionState('PRINTED')).toBe(false);
  });

  it('formats the immutable address without empty lines', () => {
    expect(
      formatOrderAddress({
        recipientName: 'Taylor Davis',
        line1: '123 Palm Avenue',
        line2: null,
        city: 'Miami',
        stateCode: 'FL',
        postalCode: '33130',
        countryCode: 'US',
      }),
    ).toEqual(['Taylor Davis', '123 Palm Avenue', 'Miami, FL 33130', 'United States']);
  });

  it('groups newest-first events by calendar date', () => {
    const groups = groupTimelineByDate([
      { id: '3', occurredAt: '2026-09-13T11:30:00.000Z' },
      { id: '2', occurredAt: '2026-09-13T09:00:00.000Z' },
      { id: '1', occurredAt: '2026-09-12T18:00:00.000Z' },
    ]);
    expect(groups.map((group) => group.events.map((event) => event.id))).toEqual([
      ['3', '2'],
      ['1'],
    ]);
  });
});
