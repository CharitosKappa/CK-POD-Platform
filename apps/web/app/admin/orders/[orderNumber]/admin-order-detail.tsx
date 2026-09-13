'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { OrderDetailSidebar } from './order-detail-sidebar';
import type { OrderDetail } from './order-detail-types';
import { OrderFulfillmentGroup } from './order-fulfillment-group';
import { OrderPaymentSummary } from './order-payment-summary';
import { OrderPrintingModal } from './order-printing-modal';
import { OrderStatusBadges } from './order-status-badges';
import { OrderTimeline } from './order-timeline';

export function AdminOrderDetail({
  orderNumber,
  apiBase = '/api/admin/orders',
  pageBase = '/admin/orders',
}: Readonly<{
  orderNumber: string;
  apiBase?: string;
  pageBase?: string;
}>) {
  const [order, setOrder] = useState<OrderDetail>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [printingGroupId, setPrintingGroupId] = useState<string>();
  const [timelineRefresh, setTimelineRefresh] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch(`${apiBase}/${encodeURIComponent(orderNumber)}`);
    const payload = (await response.json()) as { order?: OrderDetail; error?: string };
    if (!response.ok || !payload.order)
      throw new Error(payload.error ?? 'Could not load this order.');
    setOrder(payload.order);
  }, [apiBase, orderNumber]);

  useEffect(() => {
    setError(undefined);
    void load().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Could not load this order.'),
    );
  }, [load]);

  const mutate = async (key: string, url: string, init: RequestInit): Promise<boolean> => {
    setBusy(key);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch(url, init);
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not update the order.');
      await load();
      setTimelineRefresh((value) => value + 1);
      setNotice('Order updated.');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update the order.');
      return false;
    } finally {
      setBusy(undefined);
    }
  };

  const addNote = (body: string) =>
    mutate('note', `${apiBase}/${encodeURIComponent(orderNumber)}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });

  const saveTags = (tags: string[]) =>
    mutate('tags', `${apiBase}/${encodeURIComponent(orderNumber)}/tags`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags }),
    });

  const runPrintingAction = async (action: string, groupId: string): Promise<boolean> => {
    const operation = action === 'RESUME' ? 'RESUME' : 'SUBMIT_FULFILLMENT_GROUP';
    return mutate(`printing:${action}`, `${apiBase}/${encodeURIComponent(orderNumber)}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: operation, fulfillmentGroupId: groupId }),
    });
  };

  if (!order && !error)
    return (
      <main className="ops-admin-page order-detail-page">
        <p className="order-page-state">Loading order…</p>
      </main>
    );

  return (
    <main className="ops-admin-page order-detail-page">
      <Link className="order-detail-breadcrumb" href={pageBase}>
        ← Orders
      </Link>
      {error ? (
        <p className="ops-admin-feedback is-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="ops-admin-feedback is-success" role="status">
          {notice}
        </p>
      ) : null}
      {order ? (
        <>
          <header className="order-detail-heading">
            <div>
              <h1>{order.orderNumber}</h1>
              <p>
                {new Date(order.createdAt).toLocaleString('en-US')} · {order.salesChannel}
              </p>
            </div>
            <OrderStatusBadges
              payment={order.paymentState}
              printing={order.printingState}
              fulfillment={order.fulfillmentState}
            />
          </header>

          <div className="order-detail-grid">
            <div className="order-detail-main">
              {order.groups.map((group) => (
                <OrderFulfillmentGroup
                  key={group.id}
                  group={group}
                  onOpenPrinting={() => setPrintingGroupId(group.id)}
                />
              ))}
              {!order.groups.length ? (
                <article className="order-detail-card">
                  <p className="order-empty-copy">No fulfillment groups have been created.</p>
                </article>
              ) : null}
              <OrderPaymentSummary order={order} />
              <OrderTimeline
                orderNumber={orderNumber}
                apiBase={apiBase}
                refreshKey={timelineRefresh}
              />
            </div>
            <OrderDetailSidebar
              order={order}
              busy={busy}
              onAddNote={addNote}
              onSaveTags={saveTags}
            />
          </div>
        </>
      ) : null}
      {printingGroupId ? (
        <OrderPrintingModal
          orderNumber={orderNumber}
          groupId={printingGroupId}
          apiBase={apiBase}
          onClose={() => setPrintingGroupId(undefined)}
          onAction={runPrintingAction}
        />
      ) : null}
    </main>
  );
}
