import { layerStatusPresentation } from './order-detail-format';
import type { OrderDetail } from './order-detail-types';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function OrderPaymentSummary({ order }: Readonly<{ order: OrderDetail }>) {
  const status = layerStatusPresentation('payment', order.paymentState);
  const rows = [
    [
      'Subtotal',
      `${order.groups.reduce((total, group) => total + group.itemCount, 0)} items`,
      order.financials.subtotalCents,
    ],
    ['Discounts', '', order.financials.discountCents > 0 ? -order.financials.discountCents : 0],
    ['Shipping', '', order.financials.shippingCents],
    ['Taxes', '', order.financials.taxCents],
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
        {rows.map(([label, detail, cents]) => (
          <div key={label}>
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
          <dd />
          <dd>{money.format(order.financials.paidCents / 100)}</dd>
        </div>
        {order.financials.refundedCents > 0 ? (
          <div>
            <dt>Refunded</dt>
            <dd />
            <dd>−{money.format(order.financials.refundedCents / 100)}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}
