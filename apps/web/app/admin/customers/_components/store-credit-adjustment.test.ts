import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  storeCreditAdjustmentPayload,
  storeCreditAdjustmentErrors,
  storeCreditAmountCents,
  storeCreditSubmitIntent,
  type StoreCreditAdjustmentDraft,
} from './store-credit-adjustment';
import { StoreCreditAdjustmentModal } from './store-credit-adjustment-modal';

const draft: StoreCreditAdjustmentDraft = {
  direction: 'CREDIT',
  amount: ' 25.50 ',
  reason: 'PROMOTION',
  note: '',
};

describe('store credit adjustment', () => {
  it('builds a credit payload without losing decimal precision', () => {
    expect(storeCreditAdjustmentPayload(draft, 'request-1')).toEqual({
      direction: 'CREDIT',
      amount: '25.50',
      reason: 'PROMOTION',
      idempotencyKey: 'request-1',
    });
    expect(storeCreditAmountCents('25.50')).toBe(2550);
    expect(storeCreditAmountCents('0.29')).toBe(29);
  });
  it('builds a debit payload and trims its optional note', () => {
    expect(
      storeCreditAdjustmentPayload(
        { ...draft, direction: 'DEBIT', amount: '5.50', note: '  Correction  ' },
        'request-2',
      ),
    ).toEqual({
      direction: 'DEBIT',
      amount: '5.50',
      reason: 'PROMOTION',
      note: 'Correction',
      idempotencyKey: 'request-2',
    });
  });
  it('requires an amount and reason before submission', () => {
    expect(storeCreditAdjustmentErrors({ ...draft, amount: '', reason: '' })).toEqual({
      amount: expect.any(String),
      reason: expect.any(String),
    });
    expect(storeCreditAdjustmentErrors(draft)).toEqual({});
  });
  it.each(['0', '-1', '1e2', '1.001', '100000.01', 'Infinity', '1,000', '01'])(
    'rejects an invalid or out-of-range amount %s',
    (amount) => {
      expect(storeCreditAdjustmentErrors({ ...draft, amount }).amount).toBeTruthy();
      expect(storeCreditAmountCents(amount)).toBeNull();
    },
  );
  it('accepts the amount boundaries and rejects long internal notes', () => {
    expect(storeCreditAmountCents('0.01')).toBe(1);
    expect(storeCreditAmountCents('100000.00')).toBe(10000000);
    expect(storeCreditAdjustmentErrors({ ...draft, note: 'x'.repeat(1001) }).note).toBeTruthy();
  });
  it('creates a key for each new intent and reuses the key for a retry', () => {
    const first = storeCreditSubmitIntent(draft);
    expect(first.idempotencyKey.length).toBeGreaterThanOrEqual(12);
    expect(storeCreditSubmitIntent({ ...draft }, first).idempotencyKey).toBe(first.idempotencyKey);
    for (const change of [
      { amount: '1.00' },
      { direction: 'DEBIT' as const },
      { reason: 'OTHER' as const },
      { note: 'changed' },
    ]) {
      expect(storeCreditSubmitIntent({ ...draft, ...change }, first).idempotencyKey).not.toBe(
        first.idempotencyKey,
      );
    }
    expect(storeCreditSubmitIntent(draft).idempotencyKey).not.toBe(first.idempotencyKey);
  });
  it('renders an accessible focused adjustment form with USD and current balance', () => {
    const markup = renderToStaticMarkup(
      createElement(StoreCreditAdjustmentModal, {
        customerId: 'customer-1',
        balanceCents: 2550,
        onClose: () => undefined,
        onSaved: async () => undefined,
      }),
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="store-credit-modal-title"');
    expect(markup).toContain('inputMode="decimal"');
    expect(markup).not.toContain('type="number"');
    expect(markup).toContain('USD ($)');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('$25.50 USD');
    expect(markup).toContain('Add credit');
    expect(markup).toContain('Internal note (optional)');
    for (const reason of ['Refund', 'Promotion', 'Customer service', 'Other'])
      expect(markup).toContain(reason);
  });
});
