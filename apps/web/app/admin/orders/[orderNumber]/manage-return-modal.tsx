'use client';

import React, { useId, useRef, useState } from 'react';

import { createOrderActionSession, type OrderActionOutcome } from './order-action-client';
import {
  ActionFeedback,
  ActionField,
  OrderActionModal,
  type OrderActionModalProps,
} from './order-action-modal';
import type { OrderDetail } from './order-detail-types';

const labels = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  IN_TRANSIT: 'In transit',
  RECEIVED: 'Received',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
} as const;

export function ManageReturnModal(
  props: OrderActionModalProps & { returned: OrderDetail['returns'][number] },
) {
  const [target, setTarget] = useState(props.returned.permittedTransitions[0] ?? '');
  const [carrier, setCarrier] = useState(props.returned.carrier ?? '');
  const [trackingNumber, setTrackingNumber] = useState(props.returned.trackingNumber ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<OrderActionOutcome>();
  const form = useId();
  const callbacks = useRef(props);
  callbacks.current = props;
  const path = `${props.apiBase}/${encodeURIComponent(props.order.orderNumber)}/returns/${encodeURIComponent(props.returned.id)}/transitions`;
  const session = useRef<ReturnType<typeof createOrderActionSession> | null>(null);
  session.current ??= createOrderActionSession(path, {
    onSaved: () => callbacks.current.onSaved(),
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target || busy) return;
    if (target === 'IN_TRANSIT' && (!carrier.trim() || !trackingNumber.trim())) {
      setError('Enter both the carrier and tracking number before marking this return in transit.');
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await session.current!.submit({
      toState: target,
      note,
      ...(target === 'IN_TRANSIT'
        ? { carrier: carrier.trim(), trackingNumber: trackingNumber.trim() }
        : {}),
    });
    setOutcome(result);
    setBusy(false);
    if (result.kind === 'success' && !result.refreshFailed) props.onClose();
  }

  return (
    <OrderActionModal
      title={`Manage return · ${props.order.orderNumber}`}
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
            Cancel
          </button>
          <button
            className="order-action-button is-primary"
            type="submit"
            form={form}
            disabled={busy || !target}
          >
            {busy ? 'Saving…' : 'Update return'}
          </button>
        </>
      }
    >
      <p className="order-action-hint">
        Update logistics only. Refunds and Store Credit remain separate actions.
      </p>
      {props.returned.permittedTransitions.length ? (
        <form id={form} onSubmit={submit}>
          <fieldset className="order-action-fields" disabled={busy}>
            <ActionField label="Next state" full>
              <select value={target} onChange={(event) => setTarget(event.target.value)}>
                {props.returned.permittedTransitions.map((state) => (
                  <option key={state} value={state}>
                    {labels[state]}
                  </option>
                ))}
              </select>
            </ActionField>
            {target === 'IN_TRANSIT' ? (
              <div className="customer-modal-grid">
                <ActionField label="Carrier">
                  <input
                    required
                    maxLength={120}
                    value={carrier}
                    onChange={(event) => setCarrier(event.target.value)}
                  />
                </ActionField>
                <ActionField label="Tracking number">
                  <input
                    required
                    maxLength={200}
                    value={trackingNumber}
                    onChange={(event) => setTrackingNumber(event.target.value)}
                  />
                </ActionField>
              </div>
            ) : null}
            <ActionField label="Staff note" full>
              <textarea
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </ActionField>
          </fieldset>
        </form>
      ) : (
        <p className="order-action-feedback" role="status">
          This return has reached a final state.
        </p>
      )}
      <ActionFeedback outcome={outcome} error={error} />
    </OrderActionModal>
  );
}
