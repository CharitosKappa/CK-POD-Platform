'use client';

import React, { useId, useState } from 'react';
import {
  ActionFeedback,
  ActionField,
  ActionFooter,
  OrderActionModal,
  useOrderAction,
  type OrderActionModalProps,
} from './order-action-modal';

export function ArchiveOrderModal(props: OrderActionModalProps) {
  const unarchive = props.order.archived;
  const action = useOrderAction(
    props,
    unarchive ? 'unarchive' : 'archive',
    'archive',
    unarchive ? 'DELETE' : 'POST',
  );
  const [note, setNote] = useState('');
  const form = useId();
  const title = unarchive ? 'Unarchive order' : 'Archive order';
  return (
    <OrderActionModal
      title={`${title} · ${props.order.orderNumber}`}
      onClose={props.onClose}
      busy={action.busy}
      footer={<ActionFooter action={action} onClose={props.onClose} label={title} form={form} />}
    >
      <p className="order-action-hint">
        {unarchive
          ? 'Restore this order to your active workspace.'
          : 'Move this completed order out of your active workspace.'}{' '}
        Its payment, printing, fulfillment and return history stay unchanged.
      </p>
      <form
        id={form}
        onSubmit={(event) => {
          event.preventDefault();
          void action.submit({ reasonCode: unarchive ? 'STAFF_UNARCHIVE' : 'STAFF_ARCHIVE', note });
        }}
      >
        <fieldset
          className="order-action-fields"
          disabled={action.busy || action.locked || !action.allowed}
        >
          <div className="customer-modal-grid">
            <ActionField label="Staff note" full>
              <textarea
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </ActionField>
          </div>
        </fieldset>
      </form>
      {!action.allowed && !action.locked ? (
        <p className="order-action-feedback" role="alert">
          This action is no longer available for the order.
        </p>
      ) : null}
      <ActionFeedback outcome={action.outcome} error={action.error} />
    </OrderActionModal>
  );
}
