'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { adminApiFetch } from '../../../../lib/admin-api';
import {
  createOrderActionSession,
  type OrderActionName,
  type OrderActionOutcome,
} from './order-action-client';
import type { OrderDetail } from './order-detail-types';

export interface OrderActionModalProps {
  order: OrderDetail;
  apiBase: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function useOrderAction(
  props: OrderActionModalProps,
  action: OrderActionName,
  resource: string,
  method: 'POST' | 'DELETE' = 'POST',
) {
  const [order, setOrder] = useState(props.order);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const callbacks = useRef(props);
  callbacks.current = props;
  const session = useRef<ReturnType<typeof createOrderActionSession> | null>(null);
  const path = `${props.apiBase}/${encodeURIComponent(props.order.orderNumber)}/${resource}`;
  session.current ??= createOrderActionSession(path, {
    method,
    onSaved: () => callbacks.current.onSaved(),
  });
  const [outcome, setOutcome] = useState<OrderActionOutcome | undefined>(
    () => session.current?.snapshot()?.outcome,
  );
  const locked = !!outcome && outcome.kind !== 'error';

  async function submit(body: unknown, resume = false) {
    if (busy) return;
    setError(undefined);
    setBusy(true);
    try {
      const result = await (resume ? session.current!.resume() : session.current!.submit(body));
      setOutcome(result);
      if (result.current) setOrder((current) => ({ ...current, ...result.current }));
      if (result.kind === 'success' && !result.refreshFailed) callbacks.current.onClose();
      else if (result.status === 409 || result.kind === 'pending' || result.kind === 'incomplete') {
        // Refresh only read state. Retain the form, durable operation and validation message.
        try {
          const response = await adminApiFetch(
            `${props.apiBase}/${encodeURIComponent(props.order.orderNumber)}`,
          );
          const payload = (await response.json()) as { order?: OrderDetail };
          if (response.ok && payload.order) setOrder(payload.order);
        } catch {
          /* The original action result remains visible and authoritative. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return {
    order,
    busy,
    outcome,
    error,
    setError,
    locked,
    allowed:
      action === 'recoverCancellation'
        ? !!order.actionRecovery?.cancellation
        : order.eligibility.actions[action],
    submit,
    recordedBody: session.current.snapshot()?.body,
    checkStatus: () => submit(undefined, true),
  };
}

export function RecordedOrderActionModal(
  props: OrderActionModalProps & {
    actionName: OrderActionName;
    resource: string;
    method?: 'POST' | 'DELETE';
  },
) {
  const action = useOrderAction(props, props.actionName, props.resource, props.method);
  const recovery = action.order.actionRecovery?.cancellation;
  const canRetry =
    recovery &&
    action.outcome?.kind === 'incomplete' &&
    ['PARTIAL', 'FAILED'].includes(recovery.status);
  return (
    <OrderActionModal
      title="Review recorded request"
      onClose={props.onClose}
      busy={action.busy}
      footer={
        <>
          <button
            className="order-action-button"
            type="button"
            onClick={props.onClose}
            disabled={action.busy}
          >
            Close
          </button>
          {action.order.actionRecovery?.canResume && action.outcome?.kind !== 'success' ? (
            <button
              className="order-action-button is-primary"
              type="button"
              disabled={action.busy}
              onClick={() => void action.checkStatus()}
            >
              {action.busy ? 'Checking…' : 'Check recorded request'}
            </button>
          ) : null}
        </>
      }
    >
      <p className="order-action-hint">
        A request from this tab has not been fully confirmed. Its original details and request
        identity were saved, so checking it cannot create a second copy of the action.
      </p>
      {typeof action.recordedBody?.amountCents === 'number' ? (
        <p>
          Requested refund:{' '}
          <strong>
            {new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: props.order.financials.currency,
            }).format(action.recordedBody.amountCents / 100)}
          </strong>
        </p>
      ) : null}
      <ActionFeedback outcome={action.outcome} error={action.error} />
      {canRetry && (props.actionName === 'cancel' || props.actionName === 'recoverCancellation') ? (
        <button
          type="button"
          className="order-action-button"
          disabled={action.busy}
          onClick={() => void action.submit({ cancellationId: recovery.cancellationId })}
        >
          Retry unresolved cancellation groups
        </button>
      ) : null}
    </OrderActionModal>
  );
}

export function OrderActionModal({
  title,
  children,
  footer,
  onClose,
  busy = false,
}: Readonly<{
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
}>) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const submitting = useRef(busy);
  submitting.current = busy;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting.current) {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const fields = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary',
        ) ?? [],
      ).filter((field) => field.getClientRects().length > 0);
      const first = fields[0],
        last = fields.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.current?.focus();
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
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      if (prior?.isConnected) prior.focus();
    };
  }, []);
  return (
    <div
      className="customer-modal-backdrop order-action-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="customer-edit-modal order-action-modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        aria-busy={busy}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="order-action-body">{children}</div>
        <footer className="order-action-footer">{footer}</footer>
      </div>
    </div>
  );
}

export function ActionFeedback({
  outcome,
  error,
}: Readonly<{ outcome?: OrderActionOutcome | undefined; error?: string | undefined }>) {
  if (!error && !outcome) return null;
  return (
    <div
      className={`order-action-feedback ${outcome?.kind === 'success' ? 'is-success' : ''}`}
      role={
        error || outcome?.kind === 'error' || outcome?.kind === 'incomplete' ? 'alert' : 'status'
      }
    >
      <p>{error ?? outcome?.message}</p>
      {outcome?.result?.cancellationId ? (
        <small>Cancellation reference: {String(outcome.result.cancellationId)}</small>
      ) : null}
      {outcome?.result?.refundId ? (
        <small>Refund reference: {String(outcome.result.refundId)}</small>
      ) : null}
    </div>
  );
}

export function ActionField({
  label,
  children,
  full = false,
}: Readonly<{ label: string; children: React.ReactNode; full?: boolean }>) {
  return (
    <label className={full ? 'full' : undefined}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ActionFooter({
  action,
  onClose,
  label,
  form,
  danger = false,
  disabled = false,
  back,
}: Readonly<{
  action: ReturnType<typeof useOrderAction>;
  onClose: () => void;
  label: string;
  form: string;
  danger?: boolean;
  disabled?: boolean;
  back?: (() => void) | undefined;
}>) {
  const canCheck = ['pending', 'uncertain'].includes(action.outcome?.kind ?? '');
  return (
    <>
      <button
        className="order-action-button"
        type="button"
        disabled={action.busy}
        onClick={back ?? onClose}
      >
        {back ? 'Back' : action.locked ? 'Close' : 'Cancel'}
      </button>
      {canCheck ? (
        <button
          className="order-action-button is-primary"
          type="button"
          disabled={action.busy}
          onClick={() => void action.checkStatus()}
        >
          {action.busy ? 'Checking…' : 'Check status'}
        </button>
      ) : !action.locked ? (
        <button
          className={`order-action-button ${danger ? 'is-danger' : 'is-primary'}`}
          type="submit"
          form={form}
          disabled={action.busy || disabled || !action.allowed}
        >
          {action.busy ? 'Saving…' : label}
        </button>
      ) : null}
    </>
  );
}
