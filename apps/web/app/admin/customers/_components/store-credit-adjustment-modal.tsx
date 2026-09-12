'use client';

import React, { useEffect, useRef, useState } from 'react';

import {
  storeCreditAdjustmentErrors,
  storeCreditAdjustmentPayload,
  storeCreditAmountCents,
  storeCreditSubmitIntent,
  type StoreCreditAdjustmentDraft,
  type StoreCreditSubmitIntent,
} from './store-credit-adjustment';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function StoreCreditAdjustmentModal({
  customerId,
  balanceCents,
  onClose,
  onSaved,
}: Readonly<{
  customerId: string;
  balanceCents: number;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}>) {
  const dialog = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const intent = useRef<StoreCreditSubmitIntent | undefined>(undefined);
  const submitting = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  const [draft, setDraft] = useState<StoreCreditAdjustmentDraft>({
    direction: 'CREDIT',
    amount: '',
    reason: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string>();
  const errors = attempted ? storeCreditAdjustmentErrors(draft) : {};
  const amountCents = storeCreditAmountCents(draft.amount);
  const projected =
    amountCents === null
      ? null
      : balanceCents + (draft.direction === 'CREDIT' ? amountCents : -amountCents);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstField.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting.current) close.current();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  function update<Key extends keyof StoreCreditAdjustmentDraft>(
    key: Key,
    value: StoreCreditAdjustmentDraft[Key],
  ) {
    if (submitting.current || draft[key] === value) return;
    intent.current = undefined;
    setError(undefined);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setAttempted(true);
    const validation = storeCreditAdjustmentErrors(draft);
    if (Object.keys(validation).length) {
      dialog.current?.querySelector<HTMLElement>(`[name="${Object.keys(validation)[0]}"]`)?.focus();
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError(undefined);
    try {
      intent.current = storeCreditSubmitIntent(draft, intent.current);
      const response = await fetch(
        `/api/admin/customers/${encodeURIComponent(customerId)}/store-credit-adjustments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(storeCreditAdjustmentPayload(draft, intent.current.idempotencyKey)),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not update store credit.');
      await onSaved('Store credit updated.');
      intent.current = undefined;
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not update store credit. Please retry.',
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function keepFocusInside(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !dialog.current) return;
    const controls = Array.from(
      dialog.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.current.focus();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || document.activeElement === dialog.current)
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="customer-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting.current) onClose();
      }}
    >
      <div
        className="customer-edit-modal customer-store-credit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-credit-modal-title"
        aria-describedby={error ? 'store-credit-error' : undefined}
        aria-busy={saving}
        ref={dialog}
        tabIndex={-1}
        onKeyDown={keepFocusInside}
      >
        <header>
          <h2 id="store-credit-modal-title">Adjust store credit</h2>
          <button aria-label="Close dialog" disabled={saving} onClick={onClose} type="button">
            ×
          </button>
        </header>
        <form onSubmit={submit} noValidate>
          <div className="customer-modal-body">
            <div
              className="customer-store-credit-direction"
              role="group"
              aria-label="Adjustment direction"
            >
              <button
                type="button"
                aria-pressed={draft.direction === 'CREDIT'}
                disabled={saving}
                onClick={() => update('direction', 'CREDIT')}
              >
                Add
              </button>
              <button
                type="button"
                aria-pressed={draft.direction === 'DEBIT'}
                disabled={saving}
                onClick={() => update('direction', 'DEBIT')}
              >
                Deduct
              </button>
            </div>
            <div className="customer-modal-grid">
              <label>
                <span>Currency</span>
                <input disabled value="USD ($)" />
              </label>
              <label>
                <span>Amount</span>
                <input
                  name="amount"
                  ref={firstField}
                  type="text"
                  inputMode="decimal"
                  required
                  disabled={saving}
                  value={draft.amount}
                  aria-invalid={Boolean(errors.amount)}
                  aria-describedby={errors.amount ? 'store-credit-amount-error' : undefined}
                  onChange={(event) => update('amount', event.target.value)}
                />
                {errors.amount ? (
                  <small
                    className="customer-store-credit-field-error"
                    id="store-credit-amount-error"
                  >
                    {errors.amount}
                  </small>
                ) : null}
              </label>
              <label className="full">
                <span>Reason</span>
                <select
                  name="reason"
                  required
                  disabled={saving}
                  value={draft.reason}
                  aria-invalid={Boolean(errors.reason)}
                  aria-describedby={errors.reason ? 'store-credit-reason-error' : undefined}
                  onChange={(event) =>
                    update('reason', event.target.value as StoreCreditAdjustmentDraft['reason'])
                  }
                >
                  <option value="">Select a reason</option>
                  <option value="REFUND">Refund</option>
                  <option value="PROMOTION">Promotion</option>
                  <option value="CUSTOMER_SERVICE">Customer service</option>
                  <option value="OTHER">Other</option>
                </select>
                {errors.reason ? (
                  <small
                    className="customer-store-credit-field-error"
                    id="store-credit-reason-error"
                  >
                    {errors.reason}
                  </small>
                ) : null}
              </label>
              <label className="full">
                <span>Internal note (optional)</span>
                <textarea
                  name="note"
                  maxLength={1000}
                  rows={3}
                  disabled={saving}
                  value={draft.note}
                  aria-invalid={Boolean(errors.note)}
                  aria-describedby={errors.note ? 'store-credit-note-error' : undefined}
                  onChange={(event) => update('note', event.target.value)}
                />
                {errors.note ? (
                  <small className="customer-store-credit-field-error" id="store-credit-note-error">
                    {errors.note}
                  </small>
                ) : null}
              </label>
            </div>
            <dl className="customer-store-credit-summary" aria-live="polite" aria-atomic="true">
              <div>
                <dt>Current balance</dt>
                <dd>{usd.format(balanceCents / 100)} USD</dd>
              </div>
              <div>
                <dt>Projected balance</dt>
                <dd>{projected === null ? '—' : `${usd.format(projected / 100)} USD`}</dd>
              </div>
            </dl>
            {error ? (
              <p className="customer-modal-error" id="store-credit-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <footer>
            <button
              className="customer-button secondary"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className={`customer-button ${draft.direction === 'DEBIT' ? 'customer-store-credit-deduct' : 'primary'}`}
              disabled={saving}
              type="submit"
            >
              {saving ? 'Saving…' : draft.direction === 'CREDIT' ? 'Add credit' : 'Deduct credit'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
