'use client';

import React, { useId, useState } from 'react';
import { formatOrderMoney } from './order-action-client';
import {
  ActionFeedback,
  ActionField,
  ActionFooter,
  OrderActionModal,
  useOrderAction,
  type OrderActionModalProps,
} from './order-action-modal';

export function CancelOrderModal(props: OrderActionModalProps) {
  const action = useOrderAction(props, 'cancel', 'cancellations');
  const [destination, setDestination] = useState(
    props.order.refundableCents > 0 ? 'ORIGINAL_PAYMENT' : 'LATER',
  );
  const [reason, setReason] = useState('CUSTOMER_REQUEST');
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [recover, setRecover] = useState(false);
  const form = useId();
  const resultId = action.outcome?.result?.cancellationId;
  const cancellationId = typeof resultId === 'string' ? resultId : action.order.cancellation?.id;
  if (recover && cancellationId)
    return <CancellationRecovery {...props} cancellationId={cancellationId} />;
  const existing = props.order.cancellation;
  if (existing && existing.status !== 'SUCCEEDED')
    return <CancellationRecovery {...props} cancellationId={existing.id} />;
  return (
    <OrderActionModal
      title={`Cancel order ${props.order.orderNumber}?`}
      onClose={props.onClose}
      busy={action.busy}
      footer={
        <ActionFooter
          action={action}
          onClose={props.onClose}
          label="Cancel order"
          form={form}
          danger
        />
      }
    >
      <form
        id={form}
        onSubmit={(event) => {
          event.preventDefault();
          void action.submit({
            refundDestination: destination,
            refundAmountCents: destination === 'LATER' ? 0 : action.order.refundableCents,
            reasonCode: reason,
            staffNote: note,
            notifyCustomer: notify,
          });
        }}
      >
        <fieldset
          disabled={action.busy || action.locked || !action.allowed}
          className="order-action-fields"
        >
          <h3>Refund payments</h3>
          <p className="order-action-hint">
            Available to refund: <strong>{formatOrderMoney(action.order.refundableCents)}</strong>
          </p>
          <div className="order-action-choices">
            {[
              [
                'ORIGINAL_PAYMENT',
                'Original payment method',
                action.order.financials.paymentMethod ?? 'Original payment',
              ],
              ['STORE_CREDIT', 'Store Credit', 'Credit the customer’s store balance'],
              ['LATER', 'Refund later', 'Cancel now and manage the refund separately'],
            ].map(([value, label, hint]) => (
              <label key={value} className={destination === value ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name={`${form}-destination`}
                  checked={destination === value}
                  disabled={value !== 'LATER' && action.order.refundableCents <= 0}
                  onChange={() => setDestination(value!)}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="customer-modal-grid">
            <ActionField label="Reason for cancellation" full>
              <select value={reason} onChange={(event) => setReason(event.target.value)}>
                <option value="CUSTOMER_REQUEST">Customer changed or cancelled order</option>
                <option value="PRODUCTION_ISSUE">Production issue</option>
                <option value="DUPLICATE_ORDER">Duplicate order</option>
                <option value="OTHER">Other</option>
              </select>
            </ActionField>
            <ActionField label="Staff note" full>
              <textarea
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
              />
              <small>Only staff can see this note.</small>
            </ActionField>
          </div>
          <label className="order-action-check">
            <input
              type="checkbox"
              checked={notify}
              onChange={(event) => setNotify(event.target.checked)}
            />
            Notify customer
          </label>
        </fieldset>
      </form>
      {!action.allowed && !action.locked ? (
        <p className="order-action-feedback" role="alert">
          This order can no longer be cancelled. Review its current printing and fulfillment state.
        </p>
      ) : null}
      <ActionFeedback outcome={action.outcome} error={action.error} />
      {action.outcome?.kind === 'incomplete' && cancellationId ? (
        <button type="button" className="order-action-button" onClick={() => setRecover(true)}>
          Review cancellation recovery
        </button>
      ) : null}
    </OrderActionModal>
  );
}

function CancellationRecovery(props: OrderActionModalProps & { cancellationId: string }) {
  const action = useOrderAction(props, 'cancel', 'cancellations');
  const form = useId();
  const cancellation = action.order.cancellation;
  return (
    <OrderActionModal
      title="Review cancellation"
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
          {action.order.eligibility.actions.edit && action.outcome?.kind !== 'success' ? (
            <button
              className="order-action-button is-primary"
              form={form}
              disabled={action.busy}
              type="submit"
            >
              {action.busy ? 'Checking…' : 'Check / retry unresolved groups'}
            </button>
          ) : null}
        </>
      }
    >
      <form
        id={form}
        onSubmit={(event) => {
          event.preventDefault();
          void action.submit({ cancellationId: props.cancellationId });
        }}
      />
      <p className="order-action-hint">
        The cancellation is recorded. Confirmed groups are preserved. The server checks uncertain
        groups and retries only eligible unresolved work.
      </p>
      {cancellation ? (
        <>
          <p>
            <strong>Status: {cancellation.status.toLowerCase()}</strong>
          </p>
          <ul className="order-action-recovery-list">
            {cancellation.groups.map((group, index) => (
              <li key={group.fulfillmentGroupId}>
                <span>Printing group {index + 1}</span>
                <strong>{group.status.replaceAll('_', ' ').toLowerCase()}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <ActionFeedback outcome={action.outcome} error={action.error} />
    </OrderActionModal>
  );
}
