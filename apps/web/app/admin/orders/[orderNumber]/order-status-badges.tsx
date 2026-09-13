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
          <span key={layer.key} className={`order-layer-badge is-${presentation.tone}`}>
            <small>{layer.label}</small>
            <strong>{presentation.label}</strong>
          </span>
        );
      })}
    </div>
  );
}
