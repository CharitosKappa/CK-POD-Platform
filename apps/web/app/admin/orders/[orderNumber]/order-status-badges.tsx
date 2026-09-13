import React from 'react';

import { layerStatusPresentation } from './order-detail-format';

export function OrderStatusBadges({
  payment,
  printing,
  fulfillment,
}: Readonly<{ payment: string; printing: string; fulfillment: string }>) {
  const layers = [
    { key: 'payment', label: 'Payment', state: payment },
    { key: 'printing', label: 'Printing', state: printing },
    { key: 'fulfillment', label: 'Fulfillment', state: fulfillment },
  ] as const;

  return (
    <div className="order-detail-statuses" aria-label="Order statuses">
      {layers.map((layer) => {
        const presentation = layerStatusPresentation(layer.key, layer.state);
        return (
          <span
            aria-label={`${layer.label}: ${presentation.label}`}
            key={layer.key}
            className={`order-layer-badge is-${presentation.tone}`}
            title={`${layer.label}: ${presentation.label}`}
          >
            <strong>{presentation.label}</strong>
          </span>
        );
      })}
    </div>
  );
}
