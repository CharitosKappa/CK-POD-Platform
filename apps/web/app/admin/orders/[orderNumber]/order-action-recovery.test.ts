import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

function storageFixture() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe('order action journal recovery', () => {
  it.each([403, 409])(
    'does not forget a lost-response refund when a later check returns %i without a durable result',
    async (status) => {
      const storage = storageFixture();
      const fetcher = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Response lost after commit'))
        .mockResolvedValueOnce(
          Response.json(
            {
              error: 'Could not confirm the request.',
              code: status === 409 ? 'ORDER_PROVIDER_FAILURE' : 'FORBIDDEN',
            },
            { status },
          ),
        );
      vi.stubGlobal('fetch', fetcher);
      const { createOrderActionSession } = await import('./order-action-client');
      await createOrderActionSession('/refunds', { storage }).submit({ amountCents: 100 });
      const reopened = createOrderActionSession('/refunds', { storage });
      expect((await reopened.resume()).kind).toBe('uncertain');
      expect(storage.values.size).toBe(1);
      await reopened.submit({ amountCents: 200 });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[0]![1].headers['Idempotency-Key']).toBe(
        fetcher.mock.calls[1]![1].headers['Idempotency-Key'],
      );
    },
  );

  it('checks a recorded failed cancellation without silently starting a new retry attempt', async () => {
    const storage = storageFixture();
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        Response.json(
          { result: { cancellationId: 'cancel-1', status: 'PARTIAL' } },
          { status: 409 },
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const { createOrderActionSession } = await import('./order-action-client');
    await createOrderActionSession('/cancellations', { storage }).submit({
      cancellationId: 'cancel-1',
    });
    const reopened = createOrderActionSession('/cancellations', { storage });
    await reopened.resume();
    expect(fetcher.mock.calls[1]![1].headers['Idempotency-Key']).toBe(
      fetcher.mock.calls[0]![1].headers['Idempotency-Key'],
    );
    await reopened.submit({ cancellationId: 'cancel-1' });
    expect(fetcher.mock.calls[2]![1].headers['Idempotency-Key']).not.toBe(
      fetcher.mock.calls[1]![1].headers['Idempotency-Key'],
    );
  });

  it('clears a completed cancellation journal once its independent refund has authoritatively failed', async () => {
    const storage = storageFixture();
    vi.stubGlobal('fetch', async () =>
      Response.json({
        result: {
          cancellationId: 'cancel-1',
          status: 'SUCCEEDED',
          refund: { refundId: 'refund-1', status: 'FAILED' },
        },
      }),
    );
    const { createOrderActionSession } = await import('./order-action-client');
    const result = await createOrderActionSession('/cancellations', { storage }).submit({
      cancellationId: 'cancel-1',
    });
    expect(result.kind).toBe('incomplete');
    expect(result.message).toContain('not completed');
    expect(storage.values.size).toBe(0);
  });

  it('clears a completed cancellation journal after a terminal partial refund', async () => {
    const storage = storageFixture();
    vi.stubGlobal('fetch', async () =>
      Response.json({
        result: {
          cancellationId: 'cancel-1',
          status: 'SUCCEEDED',
          refund: {
            refundId: 'refund-1',
            status: 'PARTIAL',
            amountCents: 1500,
            succeededAmountCents: 900,
            failedAmountCents: 600,
          },
        },
      }),
    );
    const { createOrderActionSession } = await import('./order-action-client');
    const result = await createOrderActionSession('/cancellations', { storage }).submit({
      cancellationId: 'cancel-1',
    });
    expect(result).toMatchObject({
      kind: 'incomplete',
      result: {
        refund: {
          status: 'PARTIAL',
          succeededAmountCents: 900,
          failedAmountCents: 600,
        },
      },
    });
    expect(storage.values.size).toBe(0);
  });

  it('reuses a committed lost-response refund key after modal close and a module reload', async () => {
    const storage = storageFixture();
    const executed = new Set<string>();
    const keys: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)['Idempotency-Key']!;
      expect([...storage.values.values()].map((value) => JSON.parse(value).key)).toContain(key);
      keys.push(key);
      if (!executed.has(key)) {
        executed.add(key);
        throw new TypeError('Response lost after commit');
      }
      return Response.json({
        result: {
          refundId: 'refund-1',
          status: 'SUCCEEDED',
          amountCents: 1500,
          destination: 'ORIGINAL_PAYMENT',
        },
      });
    });
    const before = await import('./order-action-client');
    const first = before.createOrderActionSession('/api/admin/orders/%2342/refunds', { storage });
    expect(
      (
        await first.submit({
          destination: 'ORIGINAL_PAYMENT',
          amountCents: 1500,
          reasonCode: 'CUSTOMER_REQUEST',
        })
      ).kind,
    ).toBe('uncertain');
    expect(storage.values.size).toBe(1);
    vi.resetModules();
    const after = await import('./order-action-client');
    const reopened = after.createOrderActionSession('/api/admin/orders/%2342/refunds', { storage });
    expect(reopened.snapshot()?.body).toMatchObject({ amountCents: 1500 });
    expect(
      (
        await reopened.submit({
          destination: 'ORIGINAL_PAYMENT',
          amountCents: 3000,
          reasonCode: 'CUSTOMER_REQUEST',
        })
      ).kind,
    ).toBe('uncertain');
    expect(keys).toHaveLength(1);
    expect((await reopened.resume()).kind).toBe('success');
    expect(keys).toEqual([keys[0], keys[0]]);
    expect(executed.size).toBe(1);
    expect(storage.values.size).toBe(0);
  });

  it('retains a pending refund across sessions and removes its journal only on a terminal result', async () => {
    const storage = storageFixture();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { result: { refundId: 'refund-2', status: 'PENDING', amountCents: 1000 } },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            error: 'The refund was not completed.',
            result: { refundId: 'refund-2', status: 'FAILED', amountCents: 1000 },
          },
          { status: 409 },
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const { createOrderActionSession } = await import('./order-action-client');
    const first = createOrderActionSession('/api/admin/orders/%2342/refunds', { storage });
    await first.submit({
      destination: 'STORE_CREDIT',
      amountCents: 1000,
      reasonCode: 'CUSTOMER_REQUEST',
    });
    const reopened = createOrderActionSession('/api/admin/orders/%2342/refunds', { storage });
    expect(reopened.snapshot()?.outcome.kind).toBe('pending');
    expect(storage.values.size).toBe(1);
    expect((await reopened.resume()).kind).toBe('incomplete');
    expect(fetcher.mock.calls[0]![1].headers['Idempotency-Key']).toBe(
      fetcher.mock.calls[1]![1].headers['Idempotency-Key'],
    );
    expect(storage.values.size).toBe(0);
  });

  it('treats a partial refund as terminal incomplete and clears the request identity for a replacement', async () => {
    const storage = storageFixture();
    vi.stubGlobal('fetch', async () =>
      Response.json(
        {
          error:
            'Only part of the refund completed. The remaining amount is available to refund again.',
          code: 'REFUND_PARTIAL',
          result: {
            refundId: 'refund-partial',
            status: 'PARTIAL',
            amountCents: 1500,
            succeededAmountCents: 900,
            failedAmountCents: 600,
          },
        },
        { status: 409 },
      ),
    );
    const { createOrderActionSession } = await import('./order-action-client');
    const outcome = await createOrderActionSession('/api/admin/orders/%2342/refunds', {
      storage,
    }).submit({ destination: 'ORIGINAL_PAYMENT', amountCents: 1500 });
    expect(outcome).toMatchObject({
      kind: 'incomplete',
      code: 'REFUND_PARTIAL',
      result: { status: 'PARTIAL', succeededAmountCents: 900, failedAmountCents: 600 },
    });
    expect(outcome.message).toContain('remaining amount is available');
    expect(storage.values.size).toBe(0);
  });

  it('persists identity before sending and refuses to send when storage is unavailable', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { createOrderActionSession } = await import('./order-action-client');
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('Quota exceeded');
      },
      removeItem: vi.fn(),
    };
    expect(
      await createOrderActionSession('/refunds', { storage }).submit({ amountCents: 100 }),
    ).toMatchObject({ kind: 'error', code: 'ACTION_JOURNAL_UNAVAILABLE' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
