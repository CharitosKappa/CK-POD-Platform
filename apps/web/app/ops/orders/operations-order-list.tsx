'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type OperationalOrder = {
  orderNumber: string;
  status: string;
  customerEmail: string;
  productName: string;
  colorCode: string;
  quantity: number;
  createdAt: string;
  latestReason: string | null;
};

type View = {
  label: string;
  id?: string;
};

const views: View[] = [
  { label: 'All' },
  { label: 'Needs review', id: 'NEEDS_REVIEW' },
  { label: 'Ready', id: 'READY' },
  { label: 'In production', id: 'IN_PRODUCTION' },
  { label: 'Partially shipped', id: 'PARTIALLY_SHIPPED' },
  { label: 'On hold', id: 'ON_HOLD' },
];

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function statusLabel(status: string): string {
  return status.toLowerCase().replaceAll('_', ' ');
}

function statusTone(status: string): string {
  if (status === 'PARTIALLY_SHIPPED') return 'shipping';
  if (['READY_FOR_PRODUCTION', 'DELIVERED'].includes(status)) return 'ready';
  if (status === 'ON_HOLD' || status === 'FAILED') return 'attention';
  if (['PAID', 'PREPRESS_REVIEW', 'COMPLIANCE_REVIEW'].includes(status)) return 'review';
  return 'neutral';
}

export function OperationsOrderList({ initialView }: Readonly<{ initialView?: string }>) {
  const [activeView, setActiveView] = useState(() =>
    Math.max(
      0,
      views.findIndex((view) => view.id === initialView),
    ),
  );
  const [orders, setOrders] = useState<OperationalOrder[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const view = views[activeView]!;

  useEffect(() => {
    setActiveView(
      Math.max(
        0,
        views.findIndex((candidate) => candidate.id === initialView),
      ),
    );
  }, [initialView]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    const params = new URLSearchParams();
    if (view.id) params.set('view', view.id);
    void fetch(`/api/ops/orders${params.size ? `?${params}` : ''}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as { orders?: OperationalOrder[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Could not load orders.');
        setOrders(payload.orders ?? []);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Could not load orders.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [view.id]);

  const subtitle = useMemo(
    () => (loading ? 'Loading orders…' : `${orders.length} order${orders.length === 1 ? '' : 's'}`),
    [loading, orders.length],
  );

  return (
    <main className="ops-admin-page">
      <header className="ops-admin-page-header">
        <div>
          <h1>Orders</h1>
          <p>{subtitle}</p>
        </div>
        <button type="button" className="ops-admin-primary" disabled>
          Create order
        </button>
      </header>
      <nav className="ops-order-views" aria-label="Order views">
        {views.map((candidate, index) => (
          <button
            key={candidate.label}
            type="button"
            className={index === activeView ? 'is-active' : undefined}
            onClick={() => setActiveView(index)}
          >
            {candidate.label}
          </button>
        ))}
      </nav>
      <div className="ops-order-toolbar">
        <span>Filter: {view.label}</span>
        <span>Newest first</span>
      </div>
      {error ? (
        <p className="ops-admin-feedback is-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="ops-order-table-wrap" aria-label="Orders">
        <table className="ops-order-table">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Date</th>
              <th scope="col">Customer</th>
              <th scope="col">Items</th>
              <th scope="col">Fulfillment</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.orderNumber}>
                <td data-label="Order">
                  <Link href={`/ops/orders/${encodeURIComponent(order.orderNumber)}`}>
                    {order.orderNumber}
                  </Link>
                  <span>
                    {order.productName} · {order.colorCode}
                  </span>
                </td>
                <td data-label="Date">{dateFormatter.format(new Date(order.createdAt))}</td>
                <td data-label="Customer">{order.customerEmail}</td>
                <td data-label="Items">{order.quantity}</td>
                <td data-label="Fulfillment">
                  <span className={`ops-status-chip ${statusTone(order.status)}`}>
                    {statusLabel(order.status)}
                  </span>
                  {order.latestReason ? (
                    <small>{order.latestReason.replaceAll('_', ' ')}</small>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !error && orders.length === 0 ? (
          <p className="ops-admin-empty">No orders in this view.</p>
        ) : null}
      </section>
    </main>
  );
}
