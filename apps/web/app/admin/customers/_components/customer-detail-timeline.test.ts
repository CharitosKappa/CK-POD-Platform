import { describe, expect, it } from 'vitest';

import { timelineContent, timelinePage } from './customer-detail-timeline';

type TimelineEntry = Parameters<typeof timelinePage>[0][number];

function timelineEntries(count: number): TimelineEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index + 1}`,
    eventType: 'PROFILE_UPDATED',
    body: null,
    metadata: {},
    actorLabel: 'admin@letitbe.local',
    createdAt:
      index < 6
        ? `2026-09-12T${String(20 - index).padStart(2, '0')}:00:00Z`
        : `2026-09-11T${String(20 - (index % 10)).padStart(2, '0')}:00:00Z`,
  }));
}

describe('customer timeline presentation', () => {
  it('limits each internal page to 10 timeline entries', () => {
    const entries = timelineEntries(31);

    expect(timelinePage(entries, 1)).toMatchObject({
      page: 1,
      totalPages: 4,
      start: 1,
      end: 10,
      total: 31,
    });
    expect(timelinePage(entries, 1).groups.flatMap((group) => group.entries)).toHaveLength(10);
    expect(timelinePage(entries, 2).groups.flatMap((group) => group.entries)).toHaveLength(10);
    expect(timelinePage(entries, 3).groups.flatMap((group) => group.entries)).toHaveLength(10);
    expect(timelinePage(entries, 4).groups.flatMap((group) => group.entries)).toHaveLength(1);
  });

  it('groups the visible page by date and repeats a split date on the next page', () => {
    const entries = timelineEntries(16);

    expect(timelinePage(entries, 1).groups.map((group) => group.label)).toEqual([
      'September 12, 2026',
      'September 11, 2026',
    ]);
    expect(timelinePage(entries, 2).groups).toMatchObject([
      {
        label: 'September 11, 2026',
        entries: [
          { id: 'event-11' },
          { id: 'event-12' },
          { id: 'event-13' },
          { id: 'event-14' },
          { id: 'event-15' },
          { id: 'event-16' },
        ],
      },
    ]);
  });

  it('keeps the requested page inside the available range', () => {
    expect(timelinePage(timelineEntries(16), 99)).toMatchObject({ page: 2, totalPages: 2 });
    expect(timelinePage([], 4)).toMatchObject({
      page: 1,
      totalPages: 1,
      start: 0,
      end: 0,
      total: 0,
      groups: [],
    });
  });

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

  it('labels generation currency amounts as design credits', () => {
    const entry = {
      id: 'design-credit:event-4',
      eventType: 'CREDIT_LEDGER',
      body: null,
      metadata: {
        amount: 2,
        balanceAfter: 5,
        entryType: 'GRANT',
      },
      actorLabel: 'System',
      createdAt: '2026-09-11T18:57:00Z',
    } satisfies TimelineEntry;

    expect(timelineContent(entry)).toEqual({
      title: 'Design credit grant',
      description: '+2 design credits · Balance 5',
    });
    expect(
      timelineContent({ ...entry, metadata: { ...entry.metadata, amount: -1, balanceAfter: 4 } }),
    ).toEqual({
      title: 'Design credit grant',
      description: '-1 design credit · Balance 4',
    });
  });

  it('describes Store Credit additions in USD with their resulting balance', () => {
    expect(
      timelineContent({
        id: 'store-credit:event-4',
        eventType: 'STORE_CREDIT_ADJUSTMENT',
        body: null,
        metadata: {
          amountCents: 1250,
          balanceAfterCents: 3750,
          direction: 'CREDIT',
          reason: 'CUSTOMER_SERVICE',
        },
        actorLabel: 'admin@letitbe.local',
        createdAt: '2026-09-11T18:57:00Z',
      }),
    ).toEqual({
      title: 'Store credit added',
      description: '$12.50 · Customer service · Balance $37.50',
    });
  });

  it('describes Store Credit deductions in USD with their resulting balance', () => {
    expect(
      timelineContent({
        id: 'store-credit:event-5',
        eventType: 'STORE_CREDIT_ADJUSTMENT',
        body: null,
        metadata: {
          amountCents: -500,
          balanceAfterCents: 3250,
          direction: 'DEBIT',
          reason: 'CUSTOMER_SERVICE',
        },
        actorLabel: 'admin@letitbe.local',
        createdAt: '2026-09-11T18:58:00Z',
      }),
    ).toEqual({
      title: 'Store credit deducted',
      description: '-$5.00 · Customer service · Balance $32.50',
    });
  });
});
