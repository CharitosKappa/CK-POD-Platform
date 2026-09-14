import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  CollectPaymentModal,
  StripeOrderEditPaymentForm,
  createCollectPaymentClient,
  createPersistedPaymentAcceptor,
  installStripePaymentElement,
  paymentCollectionAllowed,
  type CollectPaymentAttempt,
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
  collectionAllowed: true,
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

  it('inserts and initializes a fresh Stripe script without assigning dataset', () => {
    const script = Object.assign(new EventTarget(), {
      src: '',
      async: false,
      setAttribute: vi.fn(),
    }) as unknown as HTMLScriptElement;
    const paymentElement = { mount: vi.fn(), destroy: vi.fn() };
    const stripe = {
      elements: vi.fn(() => ({ create: vi.fn(() => paymentElement) })),
      confirmPayment: vi.fn(),
    };
    const document = {
      querySelector: vi.fn(() => null),
      createElement: vi.fn(() => script),
      head: {
        appendChild: vi.fn((node: EventTarget) => {
          node.dispatchEvent(new Event('load'));
          return node;
        }),
      },
    } as unknown as Document;
    const mount = {} as HTMLDivElement;

    const cleanup = installStripePaymentElement({
      document,
      mount,
      publishableKey: 'pk_test_public',
      clientSecret: attempt.clientSecret,
      stripeFactory: () => () => stripe,
      onReady: vi.fn(),
    });

    expect(script.src).toBe('https://js.stripe.com/v3/');
    expect(script.async).toBe(true);
    expect(script.setAttribute).toHaveBeenCalledWith('data-stripe-js', 'true');
    expect(document.head.appendChild).toHaveBeenCalledWith(script);
    expect(stripe.elements).toHaveBeenCalledWith({
      clientSecret: attempt.clientSecret,
      appearance: { theme: 'stripe' },
    });
    expect(paymentElement.mount).toHaveBeenCalledWith(mount);
    cleanup();
    expect(paymentElement.destroy).toHaveBeenCalledOnce();
  });

  it('retries the persisted order refresh when the first refresh fails', async () => {
    const onSaved = vi
      .fn()
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce(undefined);
    const accept = createPersistedPaymentAcceptor(onSaved);

    await expect(accept(attemptWithStatus('SUCCEEDED'))).rejects.toThrow('refresh failed');
    await expect(accept(attemptWithStatus('SUCCEEDED'))).resolves.toMatchObject({
      status: 'SUCCEEDED',
    });
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('never allows an obsolete recovered attempt to mount or submit collection', () => {
    expect(
      paymentCollectionAllowed(900, {
        ...attempt,
        amountCents: 700,
        collectionAllowed: false,
        clientSecret: null,
      }),
    ).toBe(false);
    expect(paymentCollectionAllowed(900, null)).toBe(true);
    expect(paymentCollectionAllowed(900, undefined)).toBe(false);
  });
});

function attemptWithStatus(status: CollectPaymentAttempt['status']): CollectPaymentAttempt {
  return { ...attempt, status };
}
