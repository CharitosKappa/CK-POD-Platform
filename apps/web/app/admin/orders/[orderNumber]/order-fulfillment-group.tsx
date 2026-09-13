import { layerStatusPresentation, sentenceCase } from './order-detail-format';
import type { OrderGroup } from './order-detail-types';
import { OrderPrintingSummary } from './order-printing-summary';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function OrderFulfillmentGroup({
  group,
  onOpenPrinting,
}: Readonly<{ group: OrderGroup; onOpenPrinting: () => void }>) {
  const fulfillment = layerStatusPresentation('fulfillment', group.fulfillmentState);

  return (
    <article className="order-detail-card order-fulfillment-card">
      <header className="order-card-header">
        <div>
          <span className={`order-card-icon is-${fulfillment.tone}`} aria-hidden="true">
            ▣
          </span>
          <h2>
            {fulfillment.label} ({group.itemCount})
          </h2>
        </div>
        {group.shippingMethod ? <small>{group.shippingMethod}</small> : null}
      </header>

      <div className="order-line-items">
        {group.items.map((item) => (
          <div key={item.id} className="order-line-item">
            <span className="order-item-thumbnail" aria-hidden="true">
              LIB
            </span>
            <div>
              <strong>{item.productName}</strong>
              <small>
                {item.color} · {item.size}
              </small>
              <small className="order-item-sku">SKU {item.sku}</small>
            </div>
            <span>
              {money.format(item.unitPriceCents / 100)} × {item.quantity}
            </span>
            <b>{money.format(item.lineTotalCents / 100)}</b>
          </div>
        ))}
      </div>

      {group.shipments.length ? (
        <div className="order-shipment-block">
          {group.shipments.map((shipment) => (
            <div key={shipment.id}>
              <span aria-hidden="true">↗</span>
              <p>
                <strong>
                  {shipment.carrier ?? 'Shipment'}
                  {shipment.service ? ` · ${shipment.service}` : ''}
                </strong>
                <small>{sentenceCase(shipment.state)}</small>
              </p>
              {shipment.trackingUrl ? (
                <a href={shipment.trackingUrl} target="_blank" rel="noreferrer">
                  {shipment.trackingNumber ?? 'Track shipment'}
                </a>
              ) : (
                <small>{shipment.trackingNumber ?? 'Tracking pending'}</small>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <OrderPrintingSummary group={group} onOpen={onOpenPrinting} />
    </article>
  );
}
