import * as React from 'react';

import { layerStatusPresentation, sentenceCase } from './order-detail-format';
import type { OrderGroup } from './order-detail-types';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function OrderFulfillmentGroup({ group }: Readonly<{ group: OrderGroup }>) {
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

      <div className="order-fulfillment-summary">
        {group.shipments.length ? (
          group.shipments.map((shipment) => (
            <div className="order-fulfillment-shipment" key={shipment.id}>
              <span className={`order-layer-badge is-${fulfillment.tone}`}>
                {sentenceCase(shipment.state)}
              </span>
              <p>
                <span aria-hidden="true">▣</span>
                <strong>
                  {shipment.carrier ?? group.shippingMethod ?? 'Shipment'}
                  {shipment.service ? ` · ${shipment.service}` : ''}
                </strong>
              </p>
              {shipment.deliveredAt || shipment.shippedAt ? (
                <p>
                  <span aria-hidden="true">◷</span>
                  <span>
                    {shipment.deliveredAt ? 'Delivered' : 'Shipped'} on{' '}
                    {formatShipmentDate(shipment.deliveredAt ?? shipment.shippedAt!)}
                  </span>
                </p>
              ) : null}
              {deliveryEstimate(group) ? (
                <p>
                  <span aria-hidden="true">◷</span>
                  <span>{deliveryEstimate(group)}</span>
                </p>
              ) : null}
              {shipment.trackingNumber ? (
                <p>
                  <span aria-hidden="true">▤</span>
                  {shipment.trackingUrl ? (
                    <a href={shipment.trackingUrl} target="_blank" rel="noreferrer">
                      Tracking: {shipment.trackingNumber}
                    </a>
                  ) : (
                    <span>Tracking: {shipment.trackingNumber}</span>
                  )}
                </p>
              ) : null}
            </div>
          ))
        ) : (
          <div className="order-fulfillment-shipment">
            <p>
              <span aria-hidden="true">▣</span>
              <strong>{group.shippingMethod ?? 'Shipping method pending'}</strong>
            </p>
            {deliveryEstimate(group) ? (
              <p>
                <span aria-hidden="true">◷</span>
                <span>{deliveryEstimate(group)}</span>
              </p>
            ) : null}
          </div>
        )}
      </div>

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
    </article>
  );
}

function deliveryEstimate(group: OrderGroup): string | null {
  const min = group.estimatedDeliveryMinDays;
  const max = group.estimatedDeliveryMaxDays;
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min !== max)
    return `Estimated delivery in ${min}–${max} business days`;
  return `Estimated delivery in ${min ?? max} business days`;
}

function formatShipmentDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
