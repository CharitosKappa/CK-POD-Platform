import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderActionsMenu, orderActionOptions } from './order-actions-menu';
import { createOrderActionSession, centsFromInput } from './order-action-client';
import { CancelOrderModal, CancellationRecoveryModal } from './cancel-order-modal';
import { RefundOrderModal } from './refund-order-modal';
import { ReturnOrderModal } from './return-order-modal';
import {
  EditOrderModal,
  buildEditPayload,
  editDraftFrom,
  rebaseEditDraft,
} from './edit-order-modal';
import { ArchiveOrderModal } from './archive-order-modal';
import { OrderPaymentSummary } from './order-payment-summary';
import {
  createPendingRefundReconciliationCheck,
  PendingRefundReconciliationModal,
} from './pending-refund-reconciliation-modal';
import { OrderDetailSidebar } from './order-detail-sidebar';
import { OrderTimelineDetails } from './order-timeline';
import type { OrderDetail } from './order-detail-types';

const order: OrderDetail = {
  actionRecovery: { canResume: true, cancellation: null },
  orderNumber: '#42',
  createdAt: '2026-09-14T12:00:00Z',
  salesChannel: 'Online Store',
  paymentState: 'PAID',
  printingState: 'NOT_STARTED',
  fulfillmentState: 'UNFULFILLED',
  eligibility: {
    actions: {
      edit: true,
      cancel: true,
      refund: true,
      return: true,
      archive: false,
      unarchive: false,
    },
    editFields: {
      items: true,
      pricing: true,
      shippingAddress: true,
      contact: true,
      notesAndTags: true,
    },
  },
  archived: false,
  archivedAt: null,
  archivedByStaffMemberId: null,
  archivedByName: null,
  amountDueCents: 0,
  refundableAdjustmentCents: 0,
  refundableCents: 3500,
  pendingRefunds: [],
  customer: {
    id: 'customer-1',
    name: 'Taylor Example',
    email: 'taylor@example.test',
    phone: null,
    orderCount: 2,
  },
  shippingAddress: {
    recipientName: 'Taylor Example',
    line1: '100 Main Street',
    line2: null,
    city: 'San Francisco',
    stateCode: 'CA',
    postalCode: '94107',
    countryCode: 'US',
  },
  billingAddress: {
    recipientName: 'Taylor Example',
    line1: '100 Main Street',
    line2: null,
    city: 'San Francisco',
    stateCode: 'CA',
    postalCode: '94107',
    countryCode: 'US',
  },
  billingMatchesShipping: true,
  financials: {
    subtotalCents: 3999,
    discountCents: 0,
    shippingCents: 500,
    taxCents: 0,
    totalCents: 4499,
    paidCents: 4499,
    refundedCents: 999,
    currency: 'USD',
    taxLines: [],
    paymentMethod: 'Credit card',
  },
  groups: [
    {
      id: 'group-1',
      providerName: 'Monster Digital',
      externalOrderId: null,
      printingState: 'NOT_STARTED',
      fulfillmentState: 'FULFILLED',
      itemCount: 1,
      shippingMethod: 'Standard',
      estimatedDeliveryMinDays: null,
      estimatedDeliveryMaxDays: null,
      attentionRequired: false,
      lastProviderSyncAt: null,
      shipments: [],
      items: [
        {
          id: 'item-1',
          productName: 'Classic T-Shirt',
          color: 'Black',
          size: 'M',
          quantity: 1,
          unitPriceCents: 3999,
          lineTotalCents: 3999,
          sku: 'retail-sku',
          productVariantId: 'variant-black-M',
          variantOptions: [
            { id: 'variant-black-M', color: 'Black', size: 'M' },
            { id: 'variant-white-L', color: 'White', size: 'L' },
          ],
          projectId: 'project-1',
          projectVersionId: 'version-1',
          mockupId: 'mockup-1',
        },
      ],
    },
  ],
  returnableItems: [
    { orderItemId: 'item-1', fulfilledQuantity: 1, returnedQuantity: 0, returnableQuantity: 1 },
  ],
  returns: [],
  cancellation: null,
  notes: [],
  tags: ['VIP'],
};
const props = {
  order,
  apiBase: '/api/admin/orders',
  onClose: vi.fn(),
  onSaved: vi.fn().mockResolvedValue(undefined),
};
const markup = <P extends object>(component: React.ComponentType<P>, values: P) =>
  renderToStaticMarkup(createElement(component, values));
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('order action surfaces', () => {
  it('keeps another admin email change out of a local phone/quantity retry', () => {
    const local = editDraftFrom(order);
    local.phone = '+1 415 555 1000';
    local.items[0]!.quantity = '2';
    const fresh = { ...order, customer: { ...order.customer, email: 'other-admin@example.test' } };
    const rebased = rebaseEditDraft(order, local, fresh);
    expect(rebased.email).toBe('other-admin@example.test');
    expect(rebased.phone).toBe('+1 415 555 1000');
    expect(buildEditPayload(fresh, local, order)).toEqual({
      reasonCode: 'STAFF_EDIT',
      note: '',
      customerPhone: '+1 415 555 1000',
      items: [{ orderItemId: 'item-1', productVariantId: 'variant-black-M', quantity: 2 }],
    });
  });
  it.each(['REQUESTED', 'PROCESSING', 'PARTIAL', 'FAILED'] as const)(
    'exposes server-authorized %s recovery without exposing a new cancellation',
    (status) => {
      const eligibility = {
        ...order.eligibility,
        actions: { ...order.eligibility.actions, cancel: false },
      };
      const recovery = {
        canResume: true,
        cancellation: { cancellationId: 'cancel-1', status },
      };
      const options = orderActionOptions(eligibility, recovery);
      expect(options.some((option) => option.action === 'cancel')).toBe(false);
      expect(options).toContainEqual({
        action: 'recoverCancellation',
        label: 'Review cancellation',
      });
      const html = markup(CancellationRecoveryModal, {
        ...props,
        order: { ...order, eligibility, actionRecovery: recovery },
      });
      expect(html).toContain('Check / retry unresolved groups');
      expect(html).not.toContain('Refund payments');
      expect(html).not.toContain('Reason for cancellation');
    },
  );
  it('allows only recorded request recovery at zero refundable balance and none for read-only staff', () => {
    const eligibility = {
      ...order.eligibility,
      actions: {
        edit: false,
        cancel: false,
        refund: false,
        return: false,
        archive: false,
        unarchive: false,
      },
    };
    expect(
      orderActionOptions(eligibility, { canResume: true, cancellation: null }, ['refund']),
    ).toEqual([{ action: 'refund', label: 'Check refund request' }]);
    expect(
      orderActionOptions(eligibility, { canResume: false, cancellation: null }, ['refund']),
    ).toEqual([]);
  });
  it('omits generic structured timeline results containing internal action payloads', () => {
    const html = markup(OrderTimelineDetails, {
      details: {
        reasonCode: 'CUSTOMER_REQUEST',
        result: JSON.stringify({
          refundId: 'internal-refund-id',
          eligibility: { actions: { cancel: true } },
        }),
      },
    });
    expect(html).not.toContain('internal-refund-id');
    expect(html).not.toContain('eligibility');
    expect(html).toContain('customer request');
  });
  it('uses only server permissions even when status labels suggest another action', () => {
    expect(orderActionOptions(order.eligibility).map((item) => item.action)).toEqual([
      'edit',
      'cancel',
      'refund',
      'return',
    ]);
    const denied = {
      ...order.eligibility,
      actions: {
        edit: false,
        cancel: false,
        refund: false,
        return: false,
        archive: false,
        unarchive: false,
      },
    };
    expect(markup(OrderActionsMenu, { eligibility: denied, onSelect: vi.fn() } as never)).toBe('');
  });
  it('offers archive and unarchive using their independent server gates', () => {
    expect(
      orderActionOptions({
        ...order.eligibility,
        actions: { ...order.eligibility.actions, archive: true },
      }).at(-1)?.label,
    ).toBe('Archive order');
    expect(
      orderActionOptions({
        ...order.eligibility,
        actions: { ...order.eligibility.actions, unarchive: true },
      }).at(-1)?.label,
    ).toBe('Unarchive order');
  });
  it('renders Cancel destinations, customer notification and no owned-inventory control', () => {
    const html = markup(CancelOrderModal, props);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Original payment method');
    expect(html).toContain('Store Credit');
    expect(html).toContain('Refund later');
    expect(html).toContain('Notify customer');
    expect(html).toContain('$35.00');
    expect(html).not.toContain('Restock');
  });
  it('shows the persisted refund cap and a review step before money moves', () => {
    const html = markup(RefundOrderModal, props);
    expect(html).toContain('$35.00');
    expect(html).toContain('Review refund');
    expect(html).toContain('Refund amount');
    expect(html).toContain('Shipping refund');
  });
  it('offers only returnable quantities with no monetary controls', () => {
    const html = markup(ReturnOrderModal, props);
    expect(html).toContain('Classic T-Shirt');
    expect(html).toContain('max="1"');
    expect(html).toContain('Return shipping required');
    expect(html).not.toContain('Original payment method');
    expect(html).not.toContain('Store Credit');
  });
  it('explains server-locked Edit fields while leaving contact editable', () => {
    const locked = {
      ...order,
      eligibility: {
        ...order.eligibility,
        editFields: {
          items: false,
          pricing: false,
          shippingAddress: false,
          contact: true,
          notesAndTags: true,
        },
      },
    };
    const html = markup(EditOrderModal, { ...props, order: locked });
    expect(html).toContain('Items and variants are locked');
    expect(html).toContain('Shipping address is locked');
    expect(html).toContain('Prices are locked');
    expect(html).toContain('Customer email');
  });
  it('keeps edit payloads partial and uses real catalog identifiers, not SKU', () => {
    const draft = editDraftFrom(order);
    expect(buildEditPayload(order, { ...draft, email: 'updated@example.test' })).toEqual({
      reasonCode: 'STAFF_EDIT',
      note: '',
      customerEmail: 'updated@example.test',
    });
    draft.items[0]!.productVariantId = 'variant-white-L';
    draft.items[0]!.quantity = '2';
    expect(buildEditPayload(order, draft)).toMatchObject({
      items: [{ orderItemId: 'item-1', productVariantId: 'variant-white-L', quantity: 2 }],
    });
  });
  it('uses a compact archive confirmation and keeps archive separate from lifecycle', () => {
    const html = markup(ArchiveOrderModal, { ...props, order: { ...order, archived: true } });
    expect(html).toContain('Unarchive order');
    expect(html).toContain('payment');
  });
  it('hides contextual refund for zero balance and shows amount due from the server', () => {
    const html = markup(OrderPaymentSummary, {
      order: { ...order, refundableCents: 0, amountDueCents: 800 },
      onRefund: vi.fn(),
    } as never);
    expect(html).not.toContain('>Refund</button>');
    expect(html).toContain('Amount due');
    expect(html).toContain('$8.00');
  });
  it('renders durable pending refunds in Payment and offers an explicit read-only reconciliation', () => {
    const pendingRefund = {
      id: 'refund-1',
      destination: 'ORIGINAL_PAYMENT' as const,
      amountCents: 1200,
      status: 'PENDING' as const,
      createdAt: '2026-09-14T12:30:00Z',
    };
    const pendingOrder = { ...order, pendingRefunds: [pendingRefund] };
    const payment = markup(OrderPaymentSummary, {
      order: pendingOrder,
      onReconcileRefund: vi.fn(),
    });
    expect(payment).toContain('Pending refund');
    expect(payment).toContain('$12.00');
    expect(payment).toContain('Check status');
    expect(
      markup(OrderPaymentSummary, {
        order: { ...pendingOrder, actionRecovery: { canResume: false, cancellation: null } },
      }),
    ).not.toContain('Check status');
    const modal = markup(PendingRefundReconciliationModal, {
      ...props,
      order: pendingOrder,
      refund: pendingRefund,
    });
    expect(modal).toContain('Check refund status');
    expect(modal).toContain('does not issue another refund');
    expect(modal).not.toContain('provider');
  });
  it('hides existing note and tag mutations from read-only staff', () => {
    vi.stubGlobal('React', React);
    const readonly = {
      ...order,
      eligibility: {
        ...order.eligibility,
        editFields: { ...order.eligibility.editFields, notesAndTags: false },
      },
    };
    const html = markup(OrderDetailSidebar, {
      order: readonly,
      busy: undefined,
      onAddNote: vi.fn(),
      onSaveTags: vi.fn(),
    } as never);
    expect(html).not.toContain('Add note');
    expect(html).not.toContain('Edit order tags');
    expect(html).toContain('VIP');
  });
  it('renders human-readable audit detail without dumping provider payloads', () => {
    const html = markup(OrderTimelineDetails, {
      details: {
        amountCents: 3500,
        destination: 'STORE_CREDIT',
        reasonCode: 'CUSTOMER_REQUEST',
        note: 'Courtesy adjustment',
        providerRefundId: 'secret-provider-id',
      },
    } as never);
    expect(html).toContain('$35.00');
    expect(html).toContain('Store Credit');
    expect(html).toContain('Courtesy adjustment');
    expect(html).not.toContain('secret-provider-id');
  });
  it('shows which commercial and contact fields changed in a persisted revision', () => {
    const html = markup(OrderTimelineDetails, {
      details: {
        beforeSnapshot: JSON.stringify({
          order: {
            customer_email: 'before@example.test',
            pricing_snapshot: { customerShippingCents: 500, discountCents: 0 },
          },
          items: [{ id: 'item-1', quantity: 1, product_variant_id: 'black-M' }],
          tags: [],
        }),
        afterSnapshot: JSON.stringify({
          order: {
            customer_email: 'after@example.test',
            pricing_snapshot: { customerShippingCents: 700, discountCents: 0 },
          },
          items: [{ id: 'item-1', quantity: 2, product_variant_id: 'black-M' }],
          tags: [],
        }),
      },
    });
    expect(html).toContain('Customer email');
    expect(html).toContain('Shipping charge');
    expect(html).toContain('Items / quantities / variants');
    expect(html).not.toContain('pricing_snapshot');
  });
  it('never sends fields that the server locked after an edit draft was opened', () => {
    const draft = editDraftFrom(order);
    draft.discount = '12.00';
    draft.items[0]!.quantity = '2';
    draft.address.line1 = 'Changed address';
    draft.email = 'after@example.test';
    const locked = {
      ...order,
      eligibility: {
        ...order.eligibility,
        editFields: {
          ...order.eligibility.editFields,
          items: false,
          pricing: false,
          shippingAddress: false,
        },
      },
    };
    expect(buildEditPayload(locked, draft)).toEqual({
      reasonCode: 'STAFF_EDIT',
      note: '',
      customerEmail: 'after@example.test',
    });
  });
});

describe('durable order mutation client', () => {
  it('dispatches one storage-independent refund check for duplicate taps', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('Storage unavailable');
      },
      setItem: () => {
        throw new Error('Storage unavailable');
      },
      removeItem: () => {
        throw new Error('Storage unavailable');
      },
    });
    let complete!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const path = '/api/admin/orders/%2342/refunds/refund-1/reconcile';
    const check = createPendingRefundReconciliationCheck(path);
    const first = check();
    const duplicateTap = check();
    complete(
      Response.json(
        { result: { refundId: 'refund-1', status: 'PENDING', amountCents: 1200 } },
        { status: 202 },
      ),
    );
    expect((await first).kind).toBe('pending');
    expect((await duplicateTap).kind).toBe('pending');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      body: '{}',
      headers: expect.objectContaining({
        'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/i),
      }),
    });
  });
  it('gives an explicit unresolved cancellation retry a new key only after a durable failed attempt', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { result: { cancellationId: 'cancel-1', status: 'PARTIAL' } },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ result: { cancellationId: 'cancel-1', status: 'SUCCEEDED' } }),
      );
    vi.stubGlobal('fetch', fetcher);
    const session = createOrderActionSession('/cancellations');
    expect((await session.submit({ cancellationId: 'cancel-1' })).kind).toBe('incomplete');
    expect((await session.submit({ cancellationId: 'cancel-1' })).kind).toBe('success');
    expect(fetcher.mock.calls[0]![1].headers['Idempotency-Key']).not.toBe(
      fetcher.mock.calls[1]![1].headers['Idempotency-Key'],
    );
  });
  it('parses decimal money without accepting fractions of a cent or exponents', () => {
    expect(centsFromInput('42.99')).toBe(4299);
    expect(centsFromInput('0.01')).toBe(1);
    expect(() => centsFromInput('1.009')).toThrow();
    expect(() => centsFromInput('1e3')).toThrow();
    expect(() => centsFromInput('-1')).toThrow();
  });
  it('coalesces duplicate taps and refreshes once after confirmed success', async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const session = createOrderActionSession('/api/admin/orders/%2342/archive', { onSaved });
    const first = session.submit({ reasonCode: 'STAFF_ARCHIVE' });
    const second = session.submit({ reasonCode: 'STAFF_ARCHIVE' });
    complete(Response.json({ result: { archived: true } }));
    expect((await first).kind).toBe('success');
    expect((await second).kind).toBe('success');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
    });
  });
  it('keeps a transport-uncertain submission on the same key and blocks a changed request', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Lost network'))
      .mockResolvedValueOnce(Response.json({ result: { status: 'SUCCEEDED' } }));
    vi.stubGlobal('fetch', fetcher);
    const session = createOrderActionSession('/refunds');
    expect((await session.submit({ amountCents: 200 })).kind).toBe('uncertain');
    expect((await session.submit({ amountCents: 300 })).kind).toBe('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await session.submit({ amountCents: 200 })).kind).toBe('success');
    expect(fetcher.mock.calls[0]![1].headers['Idempotency-Key']).toBe(
      fetcher.mock.calls[1]![1].headers['Idempotency-Key'],
    );
  });
  it.each([202, 409])(
    'retains durable %i results and never claims success or refresh completion',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          Response.json(
            {
              error: 'Review unresolved groups.',
              code: 'CANCELLATION_INCOMPLETE',
              result: {
                cancellationId: 'cancel-1',
                status: status === 202 ? 'PROCESSING' : 'PARTIAL',
              },
            },
            { status },
          ),
        ),
      );
      const onSaved = vi.fn();
      const result = await createOrderActionSession('/cancellations', { onSaved }).submit({
        reasonCode: 'CUSTOMER_REQUEST',
      });
      expect(result.kind).toBe(status === 202 ? 'pending' : 'incomplete');
      expect(result.result?.cancellationId).toBe('cancel-1');
      expect(onSaved).not.toHaveBeenCalled();
    },
  );
  it('retains validation text and allows a corrected form submission with a new key', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: 'Enter a valid email.' }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ result: { revisionId: 'revision-1' } }));
    vi.stubGlobal('fetch', fetcher);
    const session = createOrderActionSession('/edits');
    expect(await session.submit({ customerEmail: 'bad' })).toMatchObject({
      kind: 'error',
      message: 'Enter a valid email.',
    });
    expect((await session.submit({ customerEmail: 'valid@example.test' })).kind).toBe('success');
    expect(fetcher.mock.calls[0]![1].headers['Idempotency-Key']).not.toBe(
      fetcher.mock.calls[1]![1].headers['Idempotency-Key'],
    );
  });
  it('treats cancelled-with-pending-refund as incomplete settlement, including 200 responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          result: {
            cancellationId: 'cancel-1',
            status: 'SUCCEEDED',
            refund: { status: 'PENDING', amountCents: 3500 },
          },
        }),
      ),
    );
    const onSaved = vi.fn();
    const result = await createOrderActionSession('/cancellations', { onSaved }).submit({
      reasonCode: 'CUSTOMER_REQUEST',
    });
    expect(result.kind).toBe('pending');
    expect(result.message).toContain('cancelled');
    expect(onSaved).not.toHaveBeenCalled();
  });
  it('does not resend an action when post-save refresh fails', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ result: { archived: true } }));
    vi.stubGlobal('fetch', fetcher);
    const session = createOrderActionSession('/archive', {
      onSaved: vi.fn().mockRejectedValue(new Error('Refresh unavailable')),
    });
    expect(await session.submit({ reasonCode: 'STAFF_ARCHIVE' })).toMatchObject({
      kind: 'success',
      refreshFailed: true,
    });
    await session.submit({ reasonCode: 'STAFF_ARCHIVE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
