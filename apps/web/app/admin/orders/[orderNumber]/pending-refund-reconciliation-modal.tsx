'use client';

import React, { useMemo, useRef, useState } from 'react';

import {
  formatOrderMoney,
  submitOrderAction,
  type OrderActionOutcome,
} from './order-action-client';
import { ActionFeedback, OrderActionModal, type OrderActionModalProps } from './order-action-modal';

export function createPendingRefundReconciliationCheck(
  path: string,
  onSaved?: () => Promise<void> | void,
) {
  let inFlight: Promise<OrderActionOutcome> | undefined;
  return function check(): Promise<OrderActionOutcome> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let result = await submitOrderAction(path, {}, { idempotencyKey: crypto.randomUUID() });
      if (result.kind === 'success') {
        try {
          await onSaved?.();
        } catch {
          result = {
            ...result,
            refreshFailed: true,
            message: 'The refund status was reconciled. Refresh the page to see the latest order.',
          };
        }
      }
      return result;
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}

export function PendingRefundReconciliationModal(
  props: OrderActionModalProps & {
    refund: OrderActionModalProps['order']['pendingRefunds'][number];
  },
) {
  const [busy, setBusy] = useState(false);
  const callbacks = useRef(props);
  callbacks.current = props;
  const path = `${props.apiBase}/${encodeURIComponent(props.order.orderNumber)}/refunds/${encodeURIComponent(props.refund.id)}/reconcile`;
  const check = useMemo(
    () => createPendingRefundReconciliationCheck(path, () => callbacks.current.onSaved()),
    [path],
  );
  const [outcome, setOutcome] = useState<OrderActionOutcome>();

  async function reconcile() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await check();
      setOutcome(result);
      if (result.kind === 'success' && !result.refreshFailed) callbacks.current.onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <OrderActionModal
      title="Check refund status"
      onClose={props.onClose}
      busy={busy}
      footer={
        <>
          <button
            className="order-action-button"
            type="button"
            disabled={busy}
            onClick={props.onClose}
          >
            Close
          </button>
          {outcome?.kind !== 'success' ? (
            <button
              className="order-action-button is-primary"
              type="button"
              disabled={busy}
              onClick={() => void reconcile()}
            >
              {busy ? 'Checking…' : 'Check status'}
            </button>
          ) : null}
        </>
      }
    >
      <div className="order-action-confirmation">
        <h3>{formatOrderMoney(props.refund.amountCents, props.order.financials.currency)}</h3>
        <p>
          This checks the recorded refund with the payment processor. It does not issue another
          refund or change its amount.
        </p>
        <small>Refund reference: {props.refund.id}</small>
      </div>
      <ActionFeedback outcome={outcome} />
    </OrderActionModal>
  );
}
