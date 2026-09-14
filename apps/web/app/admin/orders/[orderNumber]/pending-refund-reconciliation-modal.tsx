'use client';

import React, { useRef, useState } from 'react';

import {
  createOrderActionSession,
  formatOrderMoney,
  type OrderActionOutcome,
} from './order-action-client';
import { ActionFeedback, OrderActionModal, type OrderActionModalProps } from './order-action-modal';

export function PendingRefundReconciliationModal(
  props: OrderActionModalProps & {
    refund: OrderActionModalProps['order']['pendingRefunds'][number];
  },
) {
  const [busy, setBusy] = useState(false);
  const callbacks = useRef(props);
  callbacks.current = props;
  const session = useRef<ReturnType<typeof createOrderActionSession> | null>(null);
  const path = `${props.apiBase}/${encodeURIComponent(props.order.orderNumber)}/refunds/${encodeURIComponent(props.refund.id)}/reconcile`;
  session.current ??= createOrderActionSession(path, {
    onSaved: () => callbacks.current.onSaved(),
  });
  const [outcome, setOutcome] = useState<OrderActionOutcome | undefined>(
    () => session.current?.snapshot()?.outcome,
  );

  async function reconcile() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await session.current!.submit({});
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
