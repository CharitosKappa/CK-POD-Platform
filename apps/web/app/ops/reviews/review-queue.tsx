'use client';

import { useEffect, useState } from 'react';

type ReviewOrder = {
  orderNumber: string;
  status: string;
  customerEmail: string;
  productName: string;
  colorCode: string;
  quantity: number;
  createdAt: string;
  latestReason: string | null;
};

/** Deliberately compact operational queue; deeper private detail is server-only. */
export function ReviewQueue() {
  const [orders, setOrders] = useState<ReviewOrder[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const load = () =>
    fetch('/api/ops/orders')
      .then(async (response) => {
        const payload = (await response.json()) as { orders?: ReviewOrder[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Could not load the review queue.');
        setOrders(payload.orders ?? []);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Could not load the review queue.'),
      );
  useEffect(() => {
    void load();
  }, []);
  const act = (orderNumber: string, payload: Record<string, string>) => {
    const action = payload.action;
    setBusy(`${orderNumber}:${action}`);
    setError(undefined);
    void fetch(`/api/ops/orders/${encodeURIComponent(orderNumber)}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Action failed.');
        return load();
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Action failed.'),
      )
      .finally(() => setBusy(undefined));
  };
  return (
    <section className="ops-review-queue" aria-label="Order review queue">
      <header>
        <p className="eyebrow">Operations</p>
        <h1>Manual order review</h1>
        <p>Every paid order needs a trusted decision before production can be prepared.</p>
      </header>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ops-queue-list">
        {orders.map((order) => (
          <article key={order.orderNumber} className="ops-queue-card">
            <div>
              <strong>{order.orderNumber}</strong>
              <span>{order.status.replaceAll('_', ' ')}</span>
            </div>
            <p>
              {order.productName} · {order.colorCode} · Qty {order.quantity}
            </p>
            <small>
              {order.customerEmail}
              {order.latestReason ? ` · ${order.latestReason.replaceAll('_', ' ')}` : ''}
            </small>
            <div className="ops-queue-actions">
              {order.status === 'PAID' ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => act(order.orderNumber, { action: 'START_PREPRESS_REVIEW' })}
                >
                  Start prepress review
                </button>
              ) : null}
              {order.status === 'PREPRESS_REVIEW' ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    act(order.orderNumber, {
                      action: 'DECIDE_REVIEW',
                      stage: 'PREPRESS',
                      outcome: 'APPROVED',
                      reasonCode: 'PRINTABILITY_CONCERN',
                    })
                  }
                >
                  Approve prepress
                </button>
              ) : null}
              {order.status === 'COMPLIANCE_REVIEW' ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    act(order.orderNumber, {
                      action: 'DECIDE_REVIEW',
                      stage: 'COMPLIANCE',
                      outcome: 'APPROVED',
                      reasonCode: 'MODERATION_REVIEW',
                    })
                  }
                >
                  Approve compliance
                </button>
              ) : null}
              {['PAID', 'PREPRESS_REVIEW', 'COMPLIANCE_REVIEW', 'ROUTING'].includes(
                order.status,
              ) ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    act(order.orderNumber, { action: 'HOLD', reasonCode: 'OPERATIONAL_HOLD' })
                  }
                >
                  Place on hold
                </button>
              ) : null}
              {order.status === 'ON_HOLD' ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => act(order.orderNumber, { action: 'RESUME' })}
                >
                  Resume review
                </button>
              ) : null}
              {order.status === 'READY_FOR_PRODUCTION' ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => act(order.orderNumber, { action: 'SUBMIT_PRODUCTION' })}
                >
                  Submit to production
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {!orders.length ? (
          <p className="ops-empty">No orders currently need trusted review.</p>
        ) : null}
      </div>
    </section>
  );
}
