import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { adminApiFetch } from '../../../../lib/admin-api';

import { layerStatusPresentation, sentenceCase } from './order-detail-format';
import type { PrintingGroupDetail } from './order-detail-types';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function OrderPrintingModal({
  orderNumber,
  groupId,
  apiBase,
  onClose,
  onAction,
}: Readonly<{
  orderNumber: string;
  groupId: string;
  apiBase: string;
  onClose: () => void;
  onAction: (action: string, groupId: string) => Promise<boolean>;
}>) {
  const [group, setGroup] = useState<PrintingGroupDetail>();
  const [error, setError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [actionBusy, setActionBusy] = useState<string>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const response = await adminApiFetch(
        `${apiBase}/${encodeURIComponent(orderNumber)}/printing-groups/${encodeURIComponent(groupId)}`,
      );
      const payload = (await response.json()) as { group?: PrintingGroupDetail; error?: string };
      if (!response.ok || !payload.group)
        throw new Error(payload.error ?? 'Could not load printing details.');
      setGroup(payload.group);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load printing details.');
    }
  }, [apiBase, groupId, orderNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const runAction = async (action: string) => {
    setActionBusy(action);
    setActionError(undefined);
    const succeeded = await onAction(action, groupId);
    if (succeeded) await load();
    else
      setActionError(
        'The printing action could not be completed. Review the order message and try again.',
      );
    setActionBusy(undefined);
  };

  const printing = group ? layerStatusPresentation('printing', group.printingState) : null;
  const fulfillment = group ? layerStatusPresentation('fulfillment', group.fulfillmentState) : null;

  return (
    <div
      className="order-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="order-printing-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="printing-modal-title"
      >
        <header>
          <div>
            <p>Print operations</p>
            <h2 id="printing-modal-title">{group?.providerName ?? 'Printing details'}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close printing details"
          >
            ×
          </button>
        </header>

        {!group && !error ? (
          <div className="order-modal-loading">
            <span />
            <p>Loading live printing data…</p>
          </div>
        ) : null}
        {error ? (
          <div className="order-modal-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : null}
        {group && printing && fulfillment ? (
          <div className="order-modal-body">
            {actionError ? (
              <p className="order-modal-action-error" role="alert">
                {actionError}
              </p>
            ) : null}
            <section className="order-modal-status-panel">
              <div>
                <small>Printing</small>
                <span className={`order-layer-badge is-${printing.tone}`}>{printing.label}</span>
              </div>
              <div>
                <small>Fulfillment</small>
                <span className={`order-layer-badge is-${fulfillment.tone}`}>
                  {fulfillment.label}
                </span>
              </div>
              <div>
                <small>Provider order</small>
                <strong>{group.externalOrderId ?? 'Not submitted'}</strong>
              </div>
              <div>
                <small>Last sync</small>
                <strong>
                  {group.lastProviderSyncAt
                    ? new Date(group.lastProviderSyncAt).toLocaleString('en-US')
                    : '—'}
                </strong>
                {group.stale ? <em>Stale</em> : null}
              </div>
            </section>

            <section className="order-modal-section">
              <div className="order-modal-section-title">
                <h3>Production readiness</h3>
                <span className={`order-readiness ${group.readiness.ready ? 'is-ready' : ''}`}>
                  {group.readiness.ready === null
                    ? 'Not evaluated'
                    : group.readiness.ready
                      ? 'Ready'
                      : 'Blocked'}
                </span>
              </div>
              {group.readiness.blockers.length ? (
                <ul>
                  {group.readiness.blockers.map((blocker) => (
                    <li key={blocker}>{sentenceCase(blocker)}</li>
                  ))}
                </ul>
              ) : (
                <p className="order-muted">No active readiness blockers.</p>
              )}
              <div className="order-modal-items">
                {group.items.map((item) => (
                  <div key={item.id}>
                    <p>
                      <strong>{item.productName}</strong>
                      <small>
                        {item.color} · {item.size} · × {item.quantity}
                      </small>
                    </p>
                    <span>{sentenceCase(item.prepressStatus)}</span>
                    <span>{item.derivativeReady ? 'File ready' : 'File pending'}</span>
                    <span>{item.proofApproved ? 'Proof approved' : 'Proof pending'}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="order-modal-section">
              <h3>Production economics</h3>
              <dl className="order-economics">
                <MoneyFact label="Retail revenue" cents={group.economics.retailRevenueCents} />
                <MoneyFact label="Production cost" cents={group.economics.productionCostCents} />
                <MoneyFact
                  label="Provider shipping"
                  cents={group.economics.providerShippingCostCents}
                />
                <MoneyFact label="Provider fees" cents={group.economics.providerFeesCents} />
                <MoneyFact label="Gross margin" cents={group.economics.grossMarginCents} strong />
                <div>
                  <dt>Margin</dt>
                  <dd>
                    {group.economics.grossMarginBasisPoints === null
                      ? '—'
                      : `${(group.economics.grossMarginBasisPoints / 100).toFixed(1)}%`}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="order-modal-section">
              <h3>Provider activity</h3>
              {group.events.length ? (
                <div className="order-provider-events">
                  {group.events.map((event) => (
                    <div key={event.id}>
                      <span />
                      <p>
                        <strong>
                          {event.fromState ? `${sentenceCase(event.fromState)} → ` : ''}
                          {sentenceCase(event.toState)}
                        </strong>
                        <small>
                          {sentenceCase(event.source)} · {sentenceCase(event.disposition)}
                        </small>
                      </p>
                      <time>{new Date(event.createdAt).toLocaleString('en-US')}</time>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="order-muted">No provider events recorded.</p>
              )}
            </section>
          </div>
        ) : null}

        {group ? (
          <footer>
            <span>Created {new Date(group.createdAt).toLocaleString('en-US')}</span>
            <div>
              {group.permittedActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={Boolean(actionBusy)}
                  onClick={() => void runAction(action)}
                >
                  {actionBusy === action
                    ? 'Working…'
                    : action === 'SUBMIT'
                      ? 'Submit to provider'
                      : sentenceCase(action)}
                </button>
              ))}
              <button type="button" className="is-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function MoneyFact({
  label,
  cents,
  strong = false,
}: Readonly<{ label: string; cents: number | null; strong?: boolean }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {strong ? (
          <strong>{cents === null ? '—' : money.format(cents / 100)}</strong>
        ) : cents === null ? (
          '—'
        ) : (
          money.format(cents / 100)
        )}
      </dd>
    </div>
  );
}
