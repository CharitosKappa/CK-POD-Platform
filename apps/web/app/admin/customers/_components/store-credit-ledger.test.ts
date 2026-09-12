import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { StoreCreditLedgerTable } from './store-credit-ledger-modal';
import { loadStoreCreditLedger } from './store-credit-ledger';

const ledger = {
  balanceCents: 0,
  currency: 'USD' as const,
  total: 2,
  page: 1,
  limit: 20,
  entries: [
    {
      id: 'debit-1',
      entryType: 'DEBIT' as const,
      amountCents: 2500,
      balanceAfterCents: 0,
      reason: 'OTHER' as const,
      note: 'Applied to order #15156',
      actorLabel: 'operations@example.test',
      createdAt: '2026-09-12T14:30:00.000Z',
    },
    {
      id: 'credit-1',
      entryType: 'CREDIT' as const,
      amountCents: 2500,
      balanceAfterCents: 2500,
      reason: 'PROMOTION' as const,
      note: 'Welcome credit',
      actorLabel: 'owner@example.test',
      createdAt: '2026-09-11T11:15:00.000Z',
    },
  ],
};

describe('Store Credit ledger loading', () => {
  it('loads the requested page with the fixed modal page size', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ledger }));

    await expect(loadStoreCreditLedger('customer/one', 2, undefined, fetcher)).resolves.toEqual(
      ledger,
    );
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/customers/customer%2Fone/store-credit-ledger?page=2&limit=20',
      {},
    );
  });

  it('surfaces the API error instead of replacing it with an empty ledger', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ error: 'Ledger unavailable.' }, { status: 503 }));

    await expect(loadStoreCreditLedger('customer-1', 1, undefined, fetcher)).rejects.toThrow(
      'Ledger unavailable.',
    );
  });
});

describe('Store Credit ledger presentation', () => {
  it('renders Shopify-like transaction columns with mutually exclusive debit and credit values', () => {
    const markup = renderToStaticMarkup(createElement(StoreCreditLedgerTable, { ledger }));

    for (const heading of ['Date', 'Event', 'Source', 'Debit', 'Credit', 'Balance']) {
      expect(markup).toContain(`>${heading}<`);
    }
    expect(markup).toContain('Applied to order #15156');
    expect(markup).toContain('Welcome credit');
    expect(markup).toContain('operations@example.test');
    expect(markup).toContain('Promotion');
    expect(markup).toContain('-$25.00');
    expect(markup).toContain('>$25.00<');
    expect(markup).toContain('>$0.00<');
  });
});
