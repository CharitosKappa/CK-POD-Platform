import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { OrderPrintingModal } from './order-printing-modal';
import { OrderPrintingSummary } from './order-printing-summary';
import type { OrderGroup } from './order-detail-types';

const group: OrderGroup = {
  id: 'group-1',
  providerName: 'Monster Digital',
  externalOrderId: 'provider-42',
  printingState: 'FAILED',
  fulfillmentState: 'UNFULFILLED',
  itemCount: 2,
  shippingMethod: 'Standard',
  attentionRequired: true,
  lastProviderSyncAt: null,
  items: [],
  shipments: [],
};

describe('order printing controls', () => {
  it('renders the compact printing summary as a real button with persisted group data', () => {
    const markup = renderToStaticMarkup(
      createElement(OrderPrintingSummary, { group, onOpen: vi.fn() }),
    );
    expect(markup).toContain('<button');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('Monster Digital');
    expect(markup).toContain('provider-42');
    expect(markup).toContain('Needs attention');
  });

  it('renders the modal with accessible dialog semantics before its lazy request resolves', () => {
    const markup = renderToStaticMarkup(
      createElement(OrderPrintingModal, {
        orderNumber: 'LIB-42',
        groupId: 'group-1',
        apiBase: '/api/admin/orders',
        onClose: vi.fn(),
        onAction: vi.fn(),
      }),
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="printing-modal-title"');
    expect(markup).toContain('Loading live printing data');
  });
});
