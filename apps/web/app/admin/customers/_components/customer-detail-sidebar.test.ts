import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerDetailModal } from './customer-detail-modals';
import { CustomerDetailSidebar, filterTagOptions } from './customer-detail-sidebar';
import type { CustomerDetail } from './customer-types';

const customer: CustomerDetail = {
  id: 'customer-1',
  email: 'maria@example.test',
  firstName: 'Maria',
  lastName: 'Example',
  phone: '+30 693 905 8947',
  name: 'Maria Example',
  customerSince: '2026-03-01T10:00:00Z',
  lastSeenAt: '2026-09-12T09:00:00Z',
  source: 'CHECKOUT',
  orderCount: 2,
  totalSpentCents: 7998,
  averageOrderValueCents: 3999,
  returnRate: 0,
  creditBalance: 4,
  storeCreditBalanceCents: 2550,
  storeCreditCurrency: 'USD',
  lastOrderAt: '2026-09-11T18:57:00Z',
  savedDesignCount: 3,
  lastDesignAt: '2026-09-11T17:00:00Z',
  emailMarketingStatus: 'SUBSCRIBED',
  smsMarketingStatus: 'SUBSCRIBED',
  preferredLocale: 'en',
  preferredLocaleSource: 'BROWSER',
  addresses: [
    {
      id: 'address-1',
      recipientName: 'Maria Example',
      line1: '47 Dimitriou Street',
      line2: null,
      city: 'Thessaloniki',
      stateCode: null,
      postalCode: '555 35',
      countryCode: 'GR',
      phone: '+30 693 905 8947',
      isDefault: true,
      source: 'PROFILE',
    },
  ],
  orders: [],
  credits: [],
  tags: ['Big Spender', 'RFM-CHAMPIONS', 'newsletter'],
  timeline: [
    {
      id: 'note-1',
      eventType: 'NOTE',
      body: 'Prefers delivery after 17:00.',
      metadata: {},
      actorLabel: 'admin@letitbe.local',
      createdAt: '2026-09-12T08:00:00Z',
    },
  ],
};

function renderSidebar(value: CustomerDetail) {
  return renderToStaticMarkup(
    createElement(CustomerDetailSidebar, { customer: value, onAction: () => undefined }),
  );
}

describe('customer detail sidebar', () => {
  it('keeps Shopify-like contact, address, marketing, tax, credit, tag and note sections visible', () => {
    const markup = renderSidebar(customer);

    expect(markup).toContain('Contact information');
    expect(markup).toContain('maria@example.test');
    expect(markup).toContain('+30 693 905 8947');
    expect(markup).toContain('Default address');
    expect(markup).toContain('47 Dimitriou Street');
    expect(markup).toContain('Marketing subscriptions');
    expect(markup).toContain('Email, SMS');
    expect(markup).toContain('Tax details');
    expect(markup).toContain('VAT number: Not provided');
    expect(markup).toContain('Store credit');
    expect(markup).toContain('4 credits');
    expect(markup).toContain('$25.50 USD');
    expect(markup).toContain('aria-label="Adjust store credit"');
    const sections = ['Contact information', 'Design credits', 'Store credit', 'Tags', 'Notes'];
    for (let index = 1; index < sections.length; index++) {
      expect(markup.indexOf(sections[index - 1]!)).toBeLessThan(markup.indexOf(sections[index]!));
    }
    for (const text of [
      'Will receive notifications in English',
      'Email, SMS',
      'VAT number: Not provided',
      'Collect tax',
    ]) {
      expect(markup).toMatch(new RegExp(`<p class="[^"]*customer-sidebar-copy[^"]*">${text}</p>`));
    }
    expect(markup).toContain('Big Spender');
    expect(markup).toContain('Prefers delivery after 17:00.');
    expect(markup).not.toContain('Design activity');
    expect(markup).toContain('Will receive notifications in English');
    expect(markup).not.toContain('Greek');
  });

  it('shows restrained empty states when optional customer details are unavailable', () => {
    const markup = renderSidebar({
      ...customer,
      phone: null,
      addresses: [],
      emailMarketingStatus: 'NOT_SUBSCRIBED',
      smsMarketingStatus: 'NOT_SUBSCRIBED',
      tags: [],
      timeline: [],
      storeCreditBalanceCents: 0,
    });

    expect(markup).toContain('Not provided');
    expect(markup).toContain('No address saved.');
    expect(markup).toContain('Marketing subscriptions');
    expect(markup).toContain('None');
    expect(markup).toContain('$0.00 USD');
    expect(markup).toContain('class="customer-sidebar-copy">None</p>');
  });
});

describe('customer tag picker', () => {
  it('renders a searchable checkbox picker for the selected customer tags', () => {
    const markup = renderToStaticMarkup(
      createElement(CustomerDetailModal, {
        customer,
        modal: 'tags',
        onClose: () => undefined,
        onSaved: async () => undefined,
      }),
    );

    expect(markup).toContain('Search or add tags');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('Big Spender');
    expect(markup).toContain('newsletter');
  });

  it('keeps matching selected tags separate from the remaining catalog', () => {
    expect(
      filterTagOptions(
        ['newsletter', 'VIP', 'Big Spender', 'RFM-CHAMPIONS'],
        ['newsletter', 'Big Spender'],
        'spend',
      ),
    ).toEqual({ selected: ['Big Spender'], available: [], addable: 'spend' });
  });

  it('offers a trimmed new tag only when the catalog has no exact case-insensitive match', () => {
    expect(filterTagOptions(['VIP', 'Newsletter'], ['VIP'], '  Creator Club  ').addable).toBe(
      'Creator Club',
    );
    expect(filterTagOptions(['VIP', 'Newsletter'], ['VIP'], 'newsletter').addable).toBeNull();
  });
});

describe('customer notification language', () => {
  it('exposes English as the only admin language option', () => {
    const markup = renderToStaticMarkup(
      createElement(CustomerDetailModal, {
        customer,
        modal: 'customer',
        onClose: () => undefined,
        onSaved: async () => undefined,
      }),
    );

    expect(markup).toContain('<option value="en" selected="">English</option>');
    expect(markup).not.toContain('Greek');
    expect(markup).not.toContain('value="el"');
  });
});
