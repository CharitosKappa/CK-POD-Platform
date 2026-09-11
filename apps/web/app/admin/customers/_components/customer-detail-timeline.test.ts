import { describe, expect, it } from 'vitest';

import { timelineContent } from './customer-detail-timeline';

describe('customer timeline presentation', () => {
  it('describes order transitions with order context', () => {
    expect(
      timelineContent({
        id: 'event-1',
        eventType: 'ORDER_STATUS_CHANGED',
        body: 'Carrier confirmed delivery',
        metadata: {
          orderNumber: 'LIB-1001',
          fromState: 'SHIPPED',
          toState: 'DELIVERED',
        },
        actorLabel: 'System',
        createdAt: '2026-09-11T18:57:00Z',
      }),
    ).toEqual({
      title: 'Order LIB-1001 status changed',
      description: 'Shipped → Delivered · Carrier confirmed delivery',
    });
  });

  it('describes profile fields and refund details', () => {
    expect(
      timelineContent({
        id: 'event-2',
        eventType: 'PROFILE_UPDATED',
        body: null,
        metadata: { changedFields: ['phone', 'default address'] },
        actorLabel: 'admin@letitbe.local',
        createdAt: '2026-09-11T18:57:00Z',
      }).description,
    ).toBe('Changed phone, default address.');
    expect(
      timelineContent({
        id: 'event-3',
        eventType: 'REFUND',
        body: null,
        metadata: {
          orderNumber: 'LIB-1001',
          amountCents: 3999,
          reasonCode: 'CUSTOMER_REQUEST',
          status: 'SUCCEEDED',
        },
        actorLabel: null,
        createdAt: '2026-09-11T18:57:00Z',
      }),
    ).toEqual({
      title: 'Refund recorded for order LIB-1001',
      description: '$39.99 · Succeeded · Customer request',
    });
  });
});
