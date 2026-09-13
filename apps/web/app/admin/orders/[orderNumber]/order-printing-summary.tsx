import * as React from 'react';

import { isPrintingAttentionState, layerStatusPresentation } from './order-detail-format';
import type { OrderGroup } from './order-detail-types';

export function OrderPrintingSummary({
  group,
  onOpen,
}: Readonly<{ group: OrderGroup; onOpen: () => void }>) {
  const status = layerStatusPresentation('printing', group.printingState);
  return (
    <button
      type="button"
      className={`order-printing-summary ${isPrintingAttentionState(group.printingState) ? 'is-attention' : ''}`}
      onClick={onOpen}
    >
      <span className={`order-printing-icon is-${status.tone}`} aria-hidden="true">
        ◫
      </span>
      <span className="order-printing-summary-copy">
        <span>
          <strong>Printing</strong>
          <i className={`order-layer-badge is-${status.tone}`}>{status.label}</i>
        </span>
        <small>
          {group.providerName}
          {group.externalOrderId ? ` · ${group.externalOrderId}` : ' · Not submitted'}
        </small>
      </span>
      {group.attentionRequired ? <b className="order-attention-flag">Needs attention</b> : null}
      <span className="order-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
