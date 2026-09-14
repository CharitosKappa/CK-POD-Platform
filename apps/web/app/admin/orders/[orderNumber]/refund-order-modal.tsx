'use client';

import React, { useId, useState } from 'react';
import { centsFromInput, formatOrderMoney } from './order-action-client';
import {
  ActionFeedback,
  ActionField,
  ActionFooter,
  OrderActionModal,
  useOrderAction,
  type OrderActionModalProps,
} from './order-action-modal';

export function RefundOrderModal(props: OrderActionModalProps) {
  const action = useOrderAction(props, 'refund', 'refunds');
  const [amount, setAmount] = useState((props.order.refundableCents / 100).toFixed(2));
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [shipping, setShipping] = useState('0.00');
  const [destination, setDestination] = useState('ORIGINAL_PAYMENT');
  const [reason, setReason] = useState('CUSTOMER_REQUEST');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const form = useId();
  const items = [
    ...new Map(
      action.order.groups.flatMap((group) => group.items).map((item) => [item.id, item]),
    ).values(),
  ];
  function useSelection() {
    try {
      setAmount(
        (
          (items.reduce((sum, item) => sum + item.unitPriceCents * (quantities[item.id] ?? 0), 0) +
            centsFromInput(shipping)) /
          100
        ).toFixed(2),
      );
      action.setError(undefined);
    } catch (error) {
      action.setError(error instanceof Error ? error.message : 'Enter valid amounts.');
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const amountCents = centsFromInput(amount);
      if (amountCents < 1 || amountCents > action.order.refundableCents)
        throw new Error('Enter an amount within the remaining refundable balance.');
      if (!confirm) {
        setConfirm(true);
        action.setError(undefined);
        return;
      }
      void action.submit({ destination, amountCents, reasonCode: reason, note });
    } catch (error) {
      action.setError(error instanceof Error ? error.message : 'Enter a valid refund amount.');
    }
  }
  return (
    <OrderActionModal
      title={
        confirm
          ? `Confirm refund · ${props.order.orderNumber}`
          : `Refund ${props.order.orderNumber}`
      }
      onClose={props.onClose}
      busy={action.busy}
      footer={
        <ActionFooter
          action={action}
          onClose={props.onClose}
          label={confirm ? 'Issue refund' : 'Review refund'}
          form={form}
          danger={confirm}
          disabled={action.order.refundableCents <= 0}
          back={confirm && !action.locked ? () => setConfirm(false) : undefined}
        />
      }
    >
      <form id={form} onSubmit={submit}>
        <fieldset
          className="order-action-fields"
          disabled={action.busy || action.locked || !action.allowed}
        >
          <div className="order-action-balance">
            <span>Remaining refundable balance</span>
            <strong>{formatOrderMoney(action.order.refundableCents)}</strong>
          </div>
          {confirm ? (
            <div className="order-action-confirmation">
              <h3>{formatOrderMoney(centsFromInput(amount))}</h3>
              <p>
                Refund to{' '}
                {destination === 'STORE_CREDIT'
                  ? 'Store Credit'
                  : (action.order.financials.paymentMethod ?? 'the original payment method')}
                .
              </p>
              <p>This will move money. It does not create a return or change fulfillment.</p>
              <dl>
                <dt>Reason</dt>
                <dd>{reason.replaceAll('_', ' ').toLowerCase()}</dd>
                {note ? (
                  <>
                    <dt>Staff note</dt>
                    <dd>{note}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          ) : (
            <>
              <details className="order-refund-calculator">
                <summary>Calculate from items and shipping</summary>
                <p className="order-action-hint">
                  Use this as an amount aid. Adjust the final refund for discounts, tax and prior
                  refunds; the server enforces the remaining balance.
                </p>
                {items.map((item) => (
                  <label className="order-action-item" key={item.id}>
                    <span>
                      <strong>{item.productName}</strong>
                      <small>
                        {item.color} · {item.size} · {formatOrderMoney(item.unitPriceCents)} each
                      </small>
                    </span>
                    <input
                      aria-label={`Refund quantity for ${item.productName} ${item.color} ${item.size}`}
                      type="number"
                      min={0}
                      max={item.quantity}
                      step={1}
                      value={quantities[item.id] ?? 0}
                      onChange={(event) =>
                        setQuantities({
                          ...quantities,
                          [item.id]: Math.max(
                            0,
                            Math.min(item.quantity, Number(event.target.value)),
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <div className="customer-modal-grid">
                  <ActionField label="Shipping refund">
                    <input
                      inputMode="decimal"
                      value={shipping}
                      onChange={(event) => setShipping(event.target.value)}
                    />
                  </ActionField>
                </div>
                <button className="order-action-button" type="button" onClick={useSelection}>
                  Use calculated amount
                </button>
              </details>
              <div className="customer-modal-grid">
                <ActionField label="Refund amount">
                  <input
                    required
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                  <small>{action.order.financials.currency}</small>
                </ActionField>
                <ActionField label="Refund destination">
                  <select
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                  >
                    <option value="ORIGINAL_PAYMENT">Original payment method</option>
                    <option value="STORE_CREDIT">Store Credit</option>
                  </select>
                </ActionField>
                <ActionField label="Reason" full>
                  <select value={reason} onChange={(event) => setReason(event.target.value)}>
                    <option value="CUSTOMER_REQUEST">Customer request</option>
                    <option value="PRODUCTION_DEFECT">Production defect</option>
                    <option value="DUPLICATE_CHARGE">Duplicate charge</option>
                    <option value="CANCELLED">Cancelled order</option>
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
            </>
          )}
        </fieldset>
      </form>
      {!action.allowed && !action.locked ? (
        <p className="order-action-feedback" role="alert">
          No refundable balance is available for this order.
        </p>
      ) : null}
      <ActionFeedback outcome={action.outcome} error={action.error} />
    </OrderActionModal>
  );
}
