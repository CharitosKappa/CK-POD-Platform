import * as React from 'react';

import { layerStatusPresentation } from './order-detail-format';
import type { OrderDetail } from './order-detail-types';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function OrderPaymentSummary({
  order,
  onRefund,
  onReconcileRefund,
  onCollectPayment,
}: Readonly<{
  order: OrderDetail;
  onRefund?: () => void;
  onReconcileRefund?: (refund: OrderDetail['pendingRefunds'][number]) => void;
  onCollectPayment?: () => void;
}>) {
  const status = layerStatusPresentation('payment', order.paymentState);
  const rows = [
    [
      'Subtotal',
      `${order.groups.reduce((total, group) => total + group.itemCount, 0)} items`,
      order.financials.subtotalCents,
    ],
    ['Discounts', '', order.financials.discountCents > 0 ? -order.financials.discountCents : 0],
    ['Shipping', '', order.financials.shippingCents],
    ...(order.financials.taxLines.length
      ? order.financials.taxLines.map(
          (line, index) =>
            [
              index === 0 ? 'Taxes' : '',
              line.rateBasisPoints === null
                ? line.label
                : `${line.label} (${formatTaxRate(line.rateBasisPoints)})`,
              line.amountCents,
            ] as const,
        )
      : ([['Taxes', '', order.financials.taxCents]] as const)),
  ] as const;

  return (
    <article className="order-detail-card order-payment-card">
      <header className="order-card-header">
        <div>
          <span className={`order-card-icon is-${status.tone}`} aria-hidden="true">
            ✓
          </span>
          <h2>{status.label}</h2>
        </div>
      </header>
      <dl>
        {rows.map(([label, detail, cents], index) => (
          <div key={`${label}-${detail}-${index}`}>
            <dt>{label}</dt>
            <dd>{detail}</dd>
            <dd>{money.format(cents / 100)}</dd>
          </div>
        ))}
        <div className="order-payment-total">
          <dt>Total</dt>
          <dd />
          <dd>{money.format(order.financials.totalCents / 100)}</dd>
        </div>
        <div className="order-payment-paid">
          <dt>Paid</dt>
          <dd>{order.financials.paymentMethod ?? 'Payment method unavailable'}</dd>
          <dd>{money.format(order.financials.paidCents / 100)}</dd>
        </div>
        {order.financials.refundedCents > 0 ? (
          <div>
            <dt>Refunded</dt>
            <dd />
            <dd>−{money.format(order.financials.refundedCents / 100)}</dd>
          </div>
        ) : null}
        {order.pendingRefunds.map((refund) => (
          <div className="order-payment-pending-refund" key={refund.id}>
            <dt>Pending refund</dt>
            <dd>
              Awaiting confirmation
              {onReconcileRefund ? (
                <button
                  type="button"
                  className="order-payment-inline-action"
                  onClick={() => onReconcileRefund(refund)}
                >
                  Check status
                </button>
              ) : null}
            </dd>
            <dd>{money.format(refund.amountCents / 100)}</dd>
          </div>
        ))}
        {order.amountDueCents > 0 ? (
          <div className="order-payment-due">
            <dt>Amount due</dt>
            <dd>Production on hold until paid</dd>
            <dd>{money.format(order.amountDueCents / 100)}</dd>
          </div>
        ) : null}
        {order.refundableAdjustmentCents > 0 ? (
          <div>
            <dt>Edit difference</dt>
            <dd>Refund available; not issued automatically</dd>
            <dd>{money.format(order.refundableAdjustmentCents / 100)}</dd>
          </div>
        ) : null}
      </dl>
      {(onCollectPayment && order.amountDueCents > 0) ||
      (onRefund && order.eligibility?.actions.refund && order.refundableCents > 0) ? (
        <footer className="order-card-action-footer">
          <small>
            {order.amountDueCents > 0
              ? `${money.format(order.amountDueCents / 100)} due before production can resume`
              : `${money.format(order.refundableCents / 100)} available to refund`}
          </small>
          <span className="order-payment-actions">
            {onRefund && order.eligibility?.actions.refund && order.refundableCents > 0 ? (
              <button type="button" className="order-action-button" onClick={onRefund}>
                Refund
              </button>
            ) : null}
            {onCollectPayment && order.amountDueCents > 0 ? (
              <button
                type="button"
                className="order-action-button is-primary"
                onClick={onCollectPayment}
              >
                Collect payment
              </button>
            ) : null}
          </span>
        </footer>
      ) : null}
    </article>
  );
}

function formatTaxRate(basisPoints: number): string {
  const percentage = basisPoints / 100;
  return `${Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(2).replace(/0$/, '')}%`;
}
