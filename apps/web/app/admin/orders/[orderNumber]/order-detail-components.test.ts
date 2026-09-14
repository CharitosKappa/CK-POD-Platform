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

  it('shows the persisted refund destination and Shopify-style net payment', () => {
    const order = {
      paymentState: 'PARTIALLY_REFUNDED',
      groups: [group],
      completedRefunds: [
        {
          id: 'refund-1',
          destination: 'ORIGINAL_PAYMENT',
          amountCents: 2000,
          reasonCode: 'ORDER_CANCELLED',
          completedAt: '2026-09-14T12:00:00.000Z',
        },
      ],
      pendingRefunds: [],
      financials: {
        subtotalCents: 3999,
        discountCents: 0,
        shippingCents: 550,
        taxCents: 350,
        totalCents: 4899,
        paidCents: 4899,
        refundedCents: 2000,
        currency: 'USD',
        taxLines: [{ label: 'California Sales Tax', rateBasisPoints: 875, amountCents: 350 }],
        paymentMethod: 'Credit card',
      },
    } as unknown as OrderDetail;

    const markup = renderToStaticMarkup(createElement(OrderPaymentSummary, { order }));

    expect(markup).toContain(
      '<dt>Refunded</dt><dd>Credit card · Reason: “Order cancelled”</dd><dd>−$20.00</dd>',
    );
    expect(markup).toContain('<dt>Net payment</dt><dd></dd><dd>$28.99</dd>');
  });

  it('summarizes mixed refund destinations and shows zero after a full refund', () => {
    const order = {
      paymentState: 'REFUNDED',
      groups: [group],
      completedRefunds: [
        {
          id: 'refund-1',
          destination: 'ORIGINAL_PAYMENT',
          amountCents: 3000,
          reasonCode: 'ORDER_CANCELLED',
          completedAt: '2026-09-14T12:00:00.000Z',
        },
        {
          id: 'refund-2',
          destination: 'STORE_CREDIT',
          amountCents: 1899,
          reasonCode: 'CUSTOMER_REQUEST',
          completedAt: '2026-09-14T12:05:00.000Z',
        },
      ],
      pendingRefunds: [],
      financials: {
        subtotalCents: 3999,
        discountCents: 0,
        shippingCents: 550,
        taxCents: 350,
        totalCents: 4899,
        paidCents: 4899,
        refundedCents: 4899,
        currency: 'USD',
        taxLines: [{ label: 'California Sales Tax', rateBasisPoints: 875, amountCents: 350 }],
        paymentMethod: 'Credit card',
      },
    } as unknown as OrderDetail;

    const markup = renderToStaticMarkup(createElement(OrderPaymentSummary, { order }));

    expect(markup).toContain(
      '<dt>Refunded</dt><dd>Credit card + Store credit · 2 refunds</dd><dd>−$48.99</dd>',
    );
    expect(markup).toContain('<dt>Net payment</dt><dd></dd><dd>$0.00</dd>');
  });

  it('does not reduce net payment for a pending refund', () => {
    const order = {
      paymentState: 'PAID',
      groups: [group],
      completedRefunds: [],
      pendingRefunds: [
        {
          id: 'refund-pending',
          destination: 'ORIGINAL_PAYMENT',
          amountCents: 1000,
          status: 'PENDING',
          createdAt: '2026-09-14T12:00:00.000Z',
        },
      ],
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

    expect(markup).toContain('<dt>Pending refund</dt>');
    expect(markup).not.toContain('<dt>Net payment</dt>');
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
