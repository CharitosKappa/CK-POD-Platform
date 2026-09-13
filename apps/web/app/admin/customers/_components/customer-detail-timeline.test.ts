import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerTimeline, timelineContent, timelinePage } from './customer-detail-timeline';

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
  it('presents one server-provided page with the full activity count', () => {
    const entries = timelineEntries(10);

    expect(timelinePage(entries, 2, 31)).toMatchObject({
      page: 2,
      totalPages: 4,
      start: 11,
      end: 20,
      total: 31,
    });
    expect(timelinePage(entries, 2, 31).groups.flatMap((group) => group.entries)).toHaveLength(10);
  });

  it('groups the visible page by date and repeats a split date on the next page', () => {
    const entries = timelineEntries(10);

    expect(timelinePage(entries, 2, 16).groups.map((group) => group.label)).toEqual([
      'September 12, 2026',
      'September 11, 2026',
    ]);
    expect(timelinePage(entries, 2, 16).groups.flatMap((group) => group.entries)).toHaveLength(10);
  });

  it('keeps the requested page inside the available range', () => {
    expect(timelinePage(timelineEntries(6), 3, 26)).toMatchObject({ page: 3, totalPages: 3 });
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

  it('describes marketing consent transitions per channel', () => {
    expect(
      timelineContent({
        id: 'consent:event-1',
        eventType: 'CONSENT_UPDATED',
        body: null,
        metadata: {
          email: { previousStatus: 'SUBSCRIBED', newStatus: 'UNSUBSCRIBED' },
          source: 'ADMIN',
        },
        actorLabel: 'admin@letitbe.local',
        createdAt: '2026-09-11T18:57:00Z',
      }),
    ).toEqual({
      title: 'Marketing preferences updated',
      description: 'Email: Subscribed → Unsubscribed',
    });
  });

  it('describes address-book changes with location and default context', () => {
    const base = {
      id: 'address:event-1',
      body: null,
      actorLabel: 'admin@letitbe.local',
      createdAt: '2026-09-11T18:57:00Z',
    };

    expect(
      timelineContent({
        ...base,
        eventType: 'ADDRESS_ADDED',
        metadata: { city: 'Miami', countryCode: 'US', isDefault: true },
      }),
    ).toEqual({
      title: 'Customer address added',
      description: 'Miami, US · Set as default',
    });
    expect(
      timelineContent({
        ...base,
        eventType: 'ADDRESS_REMOVED',
        metadata: { promotedAddressId: '00000000-0000-4000-8000-000000000066' },
      }),
    ).toEqual({
      title: 'Customer address removed',
      description: 'Another address was set as default',
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

  it('renders the Store Credit note once as detail alongside the monetary summary', () => {
    const entry: TimelineEntry = {
      id: 'store-credit:event-6',
      eventType: 'STORE_CREDIT_ADJUSTMENT',
      body: 'Replacement shipping courtesy',
      metadata: {
        amountCents: 1250,
        balanceAfterCents: 3750,
        direction: 'CREDIT',
        reason: 'CUSTOMER_SERVICE',
        currency: 'USD',
      },
      actorLabel: 'admin@letitbe.local',
      createdAt: '2026-09-11T18:57:00Z',
    };

    const markup = renderToStaticMarkup(createElement(CustomerTimeline, { entries: [entry] }));

    expect(markup).toContain('<blockquote>Replacement shipping courtesy</blockquote>');
    expect(markup.match(/Replacement shipping courtesy/g)).toHaveLength(1);
    expect(markup).toContain('$12.50 · Customer service · Balance $37.50');
    expect(timelineContent(entry).description).not.toContain(entry.body);
  });
});
