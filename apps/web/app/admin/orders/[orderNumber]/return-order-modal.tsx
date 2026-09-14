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

export function ReturnOrderModal(props: OrderActionModalProps) {
  const action = useOrderAction(props, 'return', 'returns');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('CUSTOMER_REQUEST');
  const [note, setNote] = useState('');
  const [shippingRequired, setShippingRequired] = useState(true);
  const form = useId();
  const items = new Map(
    action.order.groups.flatMap((group) => group.items).map((item) => [item.id, item]),
  );
  const returnable = action.order.returnableItems.filter((item) => item.returnableQuantity > 0);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const selected = returnable
      .map((item) => ({
        orderItemId: item.orderItemId,
        quantity: Number(quantities[item.orderItemId] ?? 0),
        cap: item.returnableQuantity,
      }))
      .filter((item) => item.quantity !== 0);
    if (
      !selected.length ||
      selected.some(
        (item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > item.cap,
      )
    ) {
      action.setError('Select quantities within the remaining returnable items.');
      return;
    }
    void action.submit({
      items: selected.map(({ orderItemId, quantity }) => ({ orderItemId, quantity })),
      reasonCode: reason,
      shippingRequired,
      note,
    });
  }
  return (
    <OrderActionModal
      title={`Create return · ${props.order.orderNumber}`}
      onClose={props.onClose}
      busy={action.busy}
      footer={
        <ActionFooter
          action={action}
          onClose={props.onClose}
          label="Create return"
          form={form}
          disabled={!returnable.length}
        />
      }
    >
      <p className="order-action-hint">
        Record the items coming back. Payment stays unchanged; any refund is a separate action.
      </p>
      <form id={form} onSubmit={submit}>
        <fieldset
          className="order-action-fields"
          disabled={action.busy || action.locked || !action.allowed}
        >
          <div className="order-action-item-list">
            {returnable.map((available) => {
              const item = items.get(available.orderItemId);
              return (
                <label className="order-action-item" key={available.orderItemId}>
                  <span>
                    <strong>{item?.productName ?? 'Order item'}</strong>
                    <small>
                      {item ? `${item.color} · ${item.size} · ` : ''}
                      {available.returnableQuantity} available to return
                    </small>
                  </span>
                  <input
                    aria-label={`Return quantity for ${item?.productName ?? available.orderItemId} ${item?.color ?? ''} ${item?.size ?? ''}`}
                    type="number"
                    step={1}
                    min={0}
                    max={available.returnableQuantity}
                    value={quantities[available.orderItemId] ?? '0'}
                    onChange={(event) =>
                      setQuantities({ ...quantities, [available.orderItemId]: event.target.value })
                    }
                  />
                </label>
              );
            })}
          </div>
          <div className="customer-modal-grid">
            <ActionField label="Reason for return" full>
              <select value={reason} onChange={(event) => setReason(event.target.value)}>
                <option value="CUSTOMER_REQUEST">Customer request</option>
                <option value="DAMAGED">Damaged item</option>
                <option value="PRINT_QUALITY">Print quality issue</option>
                <option value="WRONG_ITEM">Wrong item</option>
                <option value="OTHER">Other</option>
              </select>
            </ActionField>
            <ActionField label="Staff note" full>
              <textarea
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </ActionField>
          </div>
          <label className="order-action-check">
            <input
              type="checkbox"
              checked={shippingRequired}
              onChange={(event) => setShippingRequired(event.target.checked)}
            />
            Return shipping required
          </label>
        </fieldset>
      </form>
      {!action.allowed || !returnable.length ? (
        <p className="order-action-feedback" role="alert">
          No fulfilled quantities remain available to return.
        </p>
      ) : null}
      <ActionFeedback outcome={action.outcome} error={action.error} />
    </OrderActionModal>
  );
}
