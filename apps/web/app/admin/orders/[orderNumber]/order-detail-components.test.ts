import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { OrderPrintingModal } from './order-printing-modal';
import { OrderPrintingSummary } from './order-printing-summary';
import { OrderFulfillmentGroup } from './order-fulfillment-group';
import { OrderPaymentSummary } from './order-payment-summary';
import { OrderStatusBadges } from './order-status-badges';
import type { OrderDetail, OrderGroup } from './order-detail-types';

const group: OrderGroup = {
  id: 'group-1',
  providerName: 'Monster Digital',
  externalOrderId: 'provider-42',
  printingState: 'FAILED',
  fulfillmentState: 'UNFULFILLED',
  itemCount: 2,
  shippingMethod: 'Standard',
  estimatedDeliveryMinDays: 5,
  estimatedDeliveryMaxDays: 8,
  attentionRequired: true,
  lastProviderSyncAt: null,
  items: [],
  shipments: [],
};

describe('order printing controls', () => {
  it('renders compact state-only badges for the order metadata row', () => {
    const markup = renderToStaticMarkup(
      createElement(OrderStatusBadges, {
        payment: 'PAID',
        printing: 'PRINTED',
        fulfillment: 'FULFILLED',
      }),
    );

    expect(markup).toContain('>Paid<');
    expect(markup).toContain('>Printed<');
    expect(markup).toContain('>Fulfilled<');
    expect(markup).not.toContain('<small>Payment</small>');
    expect(markup).not.toContain('<small>Printing</small>');
    expect(markup).not.toContain('<small>Fulfillment</small>');
  });

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

  it('keeps the fulfillment card independent from the printing layer', () => {
    const markup = renderToStaticMarkup(createElement(OrderFulfillmentGroup, { group }));

    expect(markup).toContain('Unfulfilled (2)');
    expect(markup).not.toContain('Printing');
    expect(markup).not.toContain('Monster Digital');
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

  it('renders the dynamic tax jurisdiction in the middle detail column', () => {
    const order = {
      paymentState: 'PAID',
      groups: [group],
      pendingRefunds: [],
      financials: {
        subtotalCents: 3999,
        discountCents: 0,
        shippingCents: 550,
        taxCents: 350,
        totalCents: 4899,
        paidCents: 4899,
        refundedCents: 0,
        currency: 'USD',
        taxLines: [{ label: 'California Sales Tax', rateBasisPoints: 875, amountCents: 350 }],
        paymentMethod: 'Credit card',
      },
    } as unknown as OrderDetail;

    const markup = renderToStaticMarkup(createElement(OrderPaymentSummary, { order }));

    expect(markup).toContain('<dt>Taxes</dt><dd>California Sales Tax (8.75%)</dd><dd>$3.50</dd>');
  });

  it('shows Collect payment only when the server-authorized caller supplies the action', () => {
    const order = {
      paymentState: 'PARTIALLY_PAID',
      amountDueCents: 700,
      groups: [group],
      pendingRefunds: [],
      eligibility: { actions: { refund: false } },
      financials: {
        subtotalCents: 3999,
        discountCents: 0,
        shippingCents: 500,
        taxCents: 0,
        totalCents: 4499,
        paidCents: 3799,
        refundedCents: 0,
        currency: 'USD',
        taxLines: [],
        paymentMethod: 'Credit card',
      },
    } as unknown as OrderDetail;

    const authorized = renderToStaticMarkup(
      createElement(OrderPaymentSummary, { order, onCollectPayment: vi.fn() }),
    );
    const restricted = renderToStaticMarkup(createElement(OrderPaymentSummary, { order }));

    expect(authorized).toContain('Collect payment');
    expect(restricted).not.toContain('Collect payment');

    const recoveryOnly = renderToStaticMarkup(
      createElement(OrderPaymentSummary, {
        order: { ...order, amountDueCents: 0 } as OrderDetail,
        onCollectPayment: vi.fn(),
      }),
    );
    expect(recoveryOnly).toContain('Review payment');
    expect(recoveryOnly).not.toContain('Collect payment');
  });
});
