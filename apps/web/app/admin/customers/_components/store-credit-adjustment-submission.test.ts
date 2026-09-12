import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadCustomerDetail, refreshCustomerAfterSave } from './customer-detail-loading';
import type { CustomerDetail } from './customer-types';
import {
  submitStoreCreditAdjustment,
  type StoreCreditAdjustmentDraft,
  type StoreCreditSubmissionState,
} from './store-credit-adjustment';

const draft: StoreCreditAdjustmentDraft = {
  direction: 'CREDIT',
  amount: '25.50',
  reason: 'PROMOTION',
  note: 'Welcome courtesy',
};
const customer: CustomerDetail = {
  id: 'customer-1',
  email: 'customer@example.test',
  firstName: 'Test',
  lastName: 'Customer',
  phone: null,
  name: 'Test Customer',
  customerSince: '2026-09-12T09:00:00Z',
  lastSeenAt: '2026-09-12T09:00:00Z',
  source: 'CHECKOUT',
  orderCount: 0,
  totalSpentCents: 0,
  averageOrderValueCents: 0,
  returnRate: 0,
  creditBalance: 4,
  storeCreditBalanceCents: 0,
  storeCreditCurrency: 'USD',
  lastOrderAt: null,
  savedDesignCount: 0,
  lastDesignAt: null,
  emailMarketingStatus: 'UNKNOWN',
  smsMarketingStatus: 'UNKNOWN',
  preferredLocale: 'en',
  preferredLocaleSource: 'DEFAULT',
  addresses: [],
  orders: [],
  credits: [],
  tags: [],
  timeline: [],
};
const refreshedCustomer: CustomerDetail = {
  ...customer,
  storeCreditBalanceCents: 2550,
  timeline: [
    {
      id: 'store-credit:entry-1',
      eventType: 'STORE_CREDIT_ADJUSTMENT',
      body: 'Welcome courtesy',
      metadata: {
        amountCents: 2550,
        balanceAfterCents: 2550,
        direction: 'CREDIT',
        reason: 'PROMOTION',
        currency: 'USD',
      },
      actorLabel: 'owner@example.test',
      createdAt: '2026-09-12T10:00:00Z',
    },
  ],
};

function adjustmentResponse(duplicate = false) {
  return Response.json({
    adjustment: { entryId: 'entry-1', balanceCents: 2550, currency: 'USD', duplicate },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function adjustmentDialog() {
  const submission: StoreCreditSubmissionState = { submitting: false, intent: undefined };
  const view = {
    open: true,
    saving: false,
    loading: false,
    customer,
    error: undefined as string | undefined,
    pageError: undefined as string | undefined,
    feedback: undefined as string | undefined,
  };
  const events: string[] = [];
  const load = (signal?: AbortSignal) =>
    loadCustomerDetail({
      customerId: customer.id,
      ...(signal ? { signal } : {}),
      setLoading: (value) => {
        view.loading = value;
      },
      setError: (value) => {
        view.pageError = value;
      },
      setCustomer: (value) => {
        view.customer = value;
        events.push('customer');
      },
    });
  const submit = (value = draft) =>
    submitStoreCreditAdjustment(submission, {
      customerId: customer.id,
      draft: value,
      onSaved: (message) =>
        refreshCustomerAfterSave(message, load, (feedback) => {
          view.feedback = feedback;
          if (feedback) events.push('feedback');
        }),
      onClose: () => {
        view.open = false;
        events.push('close');
      },
      setSaving: (value) => {
        view.saving = value;
      },
      setError: (value) => {
        view.error = value;
      },
    });
  return { submission, view, events, load, submit };
}

afterEach(() => vi.unstubAllGlobals());

describe('Store Credit submission and customer reload', () => {
  it('keeps a saved adjustment open on reload failure and closes only after a same-key retry reloads', async () => {
    const nextReload = deferredResponse();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(adjustmentResponse())
      .mockResolvedValueOnce(
        Response.json({ error: 'Customer refresh unavailable.' }, { status: 503 }),
      )
      .mockResolvedValueOnce(adjustmentResponse(true))
      .mockReturnValueOnce(nextReload.promise);
    vi.stubGlobal('fetch', request);
    const dialog = adjustmentDialog();

    await dialog.submit();

    expect(dialog.view).toMatchObject({
      open: true,
      saving: false,
      feedback: undefined,
      pageError: 'Customer refresh unavailable.',
      customer: { storeCreditBalanceCents: 0, timeline: [] },
    });
    expect(dialog.view.error).toMatch(/saved.*could not be refreshed.*retry/i);
    expect(dialog.submission.intent?.idempotencyKey).toBeTruthy();
    expect(dialog.events).toEqual([]);

    const retry = dialog.submit();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    expect(dialog.view).toMatchObject({ open: true, saving: true, feedback: undefined });
    expect(dialog.events).toEqual([]);
    await dialog.submit();
    expect(request).toHaveBeenCalledTimes(4);
    const firstRequest = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    const retriedRequest = JSON.parse(String(request.mock.calls[2]?.[1]?.body));
    expect(retriedRequest).toEqual(firstRequest);
    expect(firstRequest).toEqual({
      direction: 'CREDIT',
      amount: '25.50',
      reason: 'PROMOTION',
      note: 'Welcome courtesy',
      idempotencyKey: expect.any(String),
    });

    nextReload.resolve(Response.json({ customer: refreshedCustomer }));
    await retry;

    expect(dialog.view).toMatchObject({
      open: false,
      saving: false,
      loading: false,
      error: undefined,
      pageError: undefined,
      feedback: 'Store credit updated.',
      customer: refreshedCustomer,
    });
    expect(dialog.events).toEqual(['customer', 'feedback', 'close']);
    expect(dialog.submission).toEqual({ submitting: false, intent: undefined });
  });

  it('suppresses a concurrent submit while the adjustment POST is pending', async () => {
    const pendingPost = deferredResponse();
    const request = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(pendingPost.promise)
      .mockResolvedValueOnce(Response.json({ customer: refreshedCustomer }));
    vi.stubGlobal('fetch', request);
    const dialog = adjustmentDialog();

    const first = dialog.submit();
    await dialog.submit();

    expect(request).toHaveBeenCalledTimes(1);
    expect(dialog.view).toMatchObject({ open: true, saving: true });
    pendingPost.resolve(adjustmentResponse());
    await first;
    expect(request).toHaveBeenCalledTimes(2);
    expect(dialog.events).toEqual(['customer', 'feedback', 'close']);
  });

  it.each([
    { amount: '1.00' },
    { direction: 'DEBIT' as const },
    { reason: 'OTHER' as const },
    { note: 'Corrected courtesy' },
  ])('uses a new intent key when a failed draft changes: %j', async (change) => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ error: 'Please retry this adjustment.' }, { status: 503 }),
      );
    vi.stubGlobal('fetch', request);
    const dialog = adjustmentDialog();

    await dialog.submit();
    await dialog.submit({ ...draft, ...change });

    const firstRequest = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    const nextRequest = JSON.parse(String(request.mock.calls[1]?.[1]?.body));
    expect(nextRequest).toMatchObject(change);
    expect(nextRequest.idempotencyKey).not.toBe(firstRequest.idempotencyKey);
    expect(dialog.view).toMatchObject({ open: true, saving: false, feedback: undefined });
    expect(dialog.events).toEqual([]);
  });

  it('retains the intent after a network failure and preserves the server error on retry', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Connection lost.'))
      .mockResolvedValueOnce(
        Response.json({ error: 'Store credit cannot be reduced below $0.00.' }, { status: 409 }),
      );
    vi.stubGlobal('fetch', request);
    const dialog = adjustmentDialog();

    await dialog.submit();
    expect(dialog.view.error).toBe('Connection lost.');
    await dialog.submit();

    expect(request.mock.calls[1]?.[1]?.body).toBe(request.mock.calls[0]?.[1]?.body);
    expect(dialog.view).toMatchObject({
      open: true,
      saving: false,
      error: 'Store credit cannot be reduced below $0.00.',
    });
    expect(dialog.events).toEqual([]);
  });

  it('reports an initial HTTP load failure in the page without rejecting', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: 'Could not load customer.' }, { status: 503 })),
    );
    const dialog = adjustmentDialog();

    await expect(dialog.load()).resolves.toBe(false);

    expect(dialog.view).toMatchObject({ loading: false, pageError: 'Could not load customer.' });
  });

  it('reports an initial network load failure in the page without rejecting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Connection lost.')),
    );
    const dialog = adjustmentDialog();

    await expect(dialog.load()).resolves.toBe(false);

    expect(dialog.view).toMatchObject({ loading: false, pageError: 'Connection lost.' });
  });

  it('silently resolves an aborted initial load', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    );
    const dialog = adjustmentDialog();

    await expect(dialog.load(controller.signal)).resolves.toBe(false);

    expect(dialog.view.pageError).toBeUndefined();
    expect(dialog.events).toEqual([]);
  });
});
