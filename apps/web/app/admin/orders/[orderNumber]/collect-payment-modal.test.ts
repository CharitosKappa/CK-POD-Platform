import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  CollectPaymentModal,
  StripeOrderEditPaymentForm,
  createCollectPaymentClient,
} from './collect-payment-modal';
import type { OrderDetail } from './order-detail-types';

const attempt = {
  paymentAttemptId: '11111111-1111-4111-8111-111111111111',
  orderRevisionId: '22222222-2222-4222-8222-222222222222',
  status: 'PENDING' as const,
  amountCents: 700,
  currency: 'USD' as const,
  clientSecret: 'client_secret_not_rendered',
  duplicate: false,
  developmentSimulationAvailable: false,
};

describe('additional payment admin UI', () => {
  it('prepares once without sending a browser-owned revision and supports server recovery reads', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      Response.json({ result: attempt }, { status: init?.method === 'POST' ? 201 : 200 }),
    );
    const client = createCollectPaymentClient('/api/admin/orders/%231/payments', fetcher);

    const [first, second] = await Promise.all([client.prepare(), client.prepare()]);
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: '{}' });
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain('Revision');

    await client.read();
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('GET');
  });

  it('renders an accessible modal while it loads durable server state', () => {
    const html = renderToStaticMarkup(
      createElement(CollectPaymentModal, {
        order: { orderNumber: '#1', amountDueCents: 700 } as OrderDetail,
        apiBase: '/api/admin/orders',
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Collect payment');
    expect(html).toContain('Loading payment status');
  });

  it('never renders the Stripe client secret as visible markup', () => {
    const html = renderToStaticMarkup(
      createElement(StripeOrderEditPaymentForm, {
        publishableKey: 'pk_test_public',
        clientSecret: attempt.clientSecret,
        onSubmitted: vi.fn(),
        onError: vi.fn(),
      }),
    );
    expect(html).toContain('Secure payment details');
    expect(html).not.toContain(attempt.clientSecret);
  });
});
