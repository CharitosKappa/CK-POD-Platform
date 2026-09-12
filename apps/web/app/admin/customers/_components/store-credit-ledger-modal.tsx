'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { loadStoreCreditLedger } from './store-credit-ledger';
import type { CustomerDetail, StoreCreditLedger } from './customer-types';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function StoreCreditLedgerModal({
  customer,
  onAdjust,
  onClose,
}: Readonly<{
  customer: CustomerDetail;
  onAdjust: () => void;
  onClose: () => void;
}>) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [ledger, setLedger] = useState<StoreCreditLedger>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') close.current();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void loadStoreCreditLedger(customer.id, page, controller.signal)
      .then((nextLedger) => setLedger(nextLedger))
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(
          reason instanceof Error ? reason.message : 'Could not load Store Credit activity.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [customer.id, page, retry]);

  const keepFocusInside = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialog.current) return;
    const controls = Array.from(
      dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'),
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.current.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const balanceCents = ledger?.balanceCents ?? customer.storeCreditBalanceCents;
  const total = ledger?.total ?? customer.storeCreditTransactionCount;
  const pageCount = ledger ? Math.max(1, Math.ceil(ledger.total / ledger.limit)) : 1;

  return (
    <div
      className="customer-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-busy={loading}
        aria-describedby={error ? 'store-credit-ledger-error' : undefined}
        aria-labelledby="store-credit-ledger-title"
        aria-modal="true"
        className="customer-edit-modal customer-store-credit-ledger-modal"
        onKeyDown={keepFocusInside}
        ref={dialog}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <p>{customer.name || customer.email}</p>
            <h2 id="store-credit-ledger-title">Store credit</h2>
          </div>
          <button aria-label="Close dialog" onClick={onClose} ref={closeButton} type="button">
            ×
          </button>
        </header>
        <div className="customer-modal-body">
          <section
            className="customer-store-credit-ledger-summary"
            aria-label="Store credit summary"
          >
            <div>
              <span>Balance</span>
              <strong>{money.format(balanceCents / 100)} USD</strong>
            </div>
            <div>
              <span>Transactions</span>
              <strong>{total}</strong>
            </div>
            <button className="customer-button primary" onClick={onAdjust} type="button">
              Adjust balance
            </button>
          </section>

          {loading && !ledger ? (
            <p className="customer-store-credit-ledger-status" role="status">
              Loading Store Credit activity…
            </p>
          ) : null}
          {error ? (
            <div
              className="customer-store-credit-ledger-status error"
              id="store-credit-ledger-error"
            >
              <p role="alert">{error}</p>
              <button
                className="customer-button secondary"
                onClick={() => setRetry((value) => value + 1)}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : null}
          {ledger && !error ? <StoreCreditLedgerTable ledger={ledger} /> : null}
        </div>
        {ledger && !error && ledger.total > ledger.limit ? (
          <footer className="customer-store-credit-ledger-footer">
            <button
              className="customer-button secondary"
              disabled={loading || page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              type="button"
            >
              Previous
            </button>
            <span>
              Page {ledger.page} of {pageCount}
            </span>
            <button
              className="customer-button secondary"
              disabled={loading || page >= pageCount}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              type="button"
            >
              Next
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

export function StoreCreditLedgerTable({ ledger }: Readonly<{ ledger: StoreCreditLedger }>) {
  if (!ledger.entries.length)
    return <p className="customer-store-credit-ledger-status">No Store Credit activity yet.</p>;

  return (
    <div className="customer-store-credit-ledger-table-wrap">
      <table className="customer-store-credit-ledger-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Event</th>
            <th>Source</th>
            <th>Debit</th>
            <th>Credit</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          {ledger.entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <time dateTime={entry.createdAt}>{dateTime.format(new Date(entry.createdAt))}</time>
              </td>
              <td>
                <strong>Adjustment</strong>
                <span>{reasonLabel(entry.reason)}</span>
                {entry.note ? <small>{entry.note}</small> : null}
              </td>
              <td>{entry.actorLabel}</td>
              <td>
                {entry.entryType === 'DEBIT' ? `-${money.format(entry.amountCents / 100)}` : '—'}
              </td>
              <td>{entry.entryType === 'CREDIT' ? money.format(entry.amountCents / 100) : '—'}</td>
              <td>{money.format(entry.balanceAfterCents / 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function reasonLabel(reason: StoreCreditLedger['entries'][number]['reason']) {
  if (reason === 'CUSTOMER_SERVICE') return 'Customer service';
  return reason.charAt(0) + reason.slice(1).toLowerCase();
}
