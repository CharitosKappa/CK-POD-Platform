'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type RecentOrder = {
  orderNumber: string;
  status: string;
  customerEmail: string;
  productName: string;
  quantity: number;
};

type Overview = {
  queues: {
    needsReview: number;
    ready: number;
    inProduction: number;
    partiallyShipped: number;
    onHold: number;
  };
  recentOrders: RecentOrder[];
};

const queues: Array<{
  key: keyof Overview['queues'];
  label: string;
  description: string;
  view: string;
  tone: string;
}> = [
  {
    key: 'needsReview',
    label: 'Needs review',
    description: 'Orders waiting for a trusted decision',
    view: 'NEEDS_REVIEW',
    tone: 'review',
  },
  {
    key: 'ready',
    label: 'Ready to submit',
    description: 'Groups ready for production',
    view: 'READY',
    tone: 'ready',
  },
  {
    key: 'inProduction',
    label: 'In production',
    description: 'Submitted and being fulfilled',
    view: 'IN_PRODUCTION',
    tone: 'production',
  },
  {
    key: 'partiallyShipped',
    label: 'Partially shipped',
    description: 'At least one group is still pending',
    view: 'PARTIALLY_SHIPPED',
    tone: 'shipping',
  },
  {
    key: 'onHold',
    label: 'On hold',
    description: 'Waiting for a manual resolution',
    view: 'ON_HOLD',
    tone: 'attention',
  },
];

function label(status: string): string {
  return status.toLowerCase().replaceAll('_', ' ');
}

export function OperationsDashboard() {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/ops/orders/overview', { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as { overview?: Overview; error?: string };
        if (!response.ok || !payload.overview)
          throw new Error(payload.error ?? 'Could not load operations overview.');
        setOverview(payload.overview);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Could not load operations overview.');
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="ops-admin-page ops-dashboard-page">
      <header className="ops-admin-page-header">
        <div>
          <h1>Home</h1>
          <p>Today&apos;s fulfillment work, ordered by what needs attention.</p>
        </div>
        <Link className="ops-admin-secondary ops-dashboard-orders-link" href="/ops/orders">
          View all orders
        </Link>
      </header>
      {error ? (
        <p className="ops-admin-feedback is-error" role="alert">
          {error}
        </p>
      ) : null}
      {!overview && !error ? (
        <p className="ops-admin-feedback">Loading operations overview…</p>
      ) : null}
      {overview ? (
        <>
          <section className="ops-dashboard-queues" aria-label="Fulfillment work queues">
            {queues.map((queue) => (
              <Link
                key={queue.key}
                href={`/ops/orders?view=${queue.view}`}
                className={`ops-dashboard-queue ${queue.tone}`}
              >
                <span>{queue.label}</span>
                <strong>{overview.queues[queue.key]}</strong>
                <small>{queue.description}</small>
              </Link>
            ))}
          </section>
          <section className="ops-dashboard-recent">
            <header>
              <div>
                <h2>Recent orders</h2>
                <p>Latest operational orders across all work states.</p>
              </div>
              <Link href="/ops/orders">View all</Link>
            </header>
            <div className="ops-order-table-wrap">
              <table className="ops-order-table">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Items</th>
                    <th scope="col">Fulfillment</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.recentOrders.map((order) => (
                    <tr key={order.orderNumber}>
                      <td data-label="Order">
                        <Link href={`/ops/orders/${encodeURIComponent(order.orderNumber)}`}>
                          {order.orderNumber}
                        </Link>
                        <span>{order.productName}</span>
                      </td>
                      <td data-label="Customer">{order.customerEmail}</td>
                      <td data-label="Items">{order.quantity}</td>
                      <td data-label="Fulfillment">
                        <span className="ops-status-chip neutral">{label(order.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!overview.recentOrders.length ? (
                <p className="ops-admin-empty">No operational orders yet.</p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
