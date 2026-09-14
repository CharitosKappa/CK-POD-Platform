'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { adminApiFetch } from '../../../../lib/admin-api';
import { AdminFeedback } from '../../_components/admin-feedback';

import { OrderDetailSidebar } from './order-detail-sidebar';
import type { OrderDetail } from './order-detail-types';
import { OrderFulfillmentGroup } from './order-fulfillment-group';
import { OrderPaymentSummary } from './order-payment-summary';
import { OrderPrintingModal } from './order-printing-modal';
import { OrderPrintingSummary } from './order-printing-summary';
import { OrderStatusBadges } from './order-status-badges';
import { OrderTimeline } from './order-timeline';
import { OrderActionsMenu, OrderActionHost } from './order-actions-menu';
import {
  hasOrderActionJournal,
  pendingOrderActions,
  type OrderActionName,
} from './order-action-client';
import { PendingRefundReconciliationModal } from './pending-refund-reconciliation-modal';
import { ManageReturnModal } from './manage-return-modal';
import { CollectPaymentModal } from './collect-payment-modal';

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
  const [activeAction, setActiveAction] = useState<OrderActionName>();
  const [pendingActions, setPendingActions] = useState<OrderActionName[]>([]);
  const [pendingRefundId, setPendingRefundId] = useState<string>();
  const [managedReturnId, setManagedReturnId] = useState<string>();
  const [collectingPayment, setCollectingPayment] = useState(false);
  const actionTrigger = useRef<HTMLElement | null>(null);
  const pendingRefund = order?.pendingRefunds.find((refund) => refund.id === pendingRefundId);
  const managedReturn = order?.returns.find((returned) => returned.id === managedReturnId);

  const load = useCallback(async () => {
    const response = await adminApiFetch(`${apiBase}/${encodeURIComponent(orderNumber)}`);
    const payload = (await response.json()) as { order?: OrderDetail; error?: string };
    if (!response.ok || !payload.order)
      throw new Error(payload.error ?? 'Could not load this order.');
    setOrder(payload.order);
    setPendingActions(pendingOrderActions(apiBase, orderNumber));
  }, [apiBase, orderNumber]);

  useEffect(() => {
    setError(undefined);
    void load().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Could not load this order.'),
    );
  }, [load]);

  const openAction = (action: OrderActionName) => {
    actionTrigger.current = document.activeElement as HTMLElement | null;
    setActiveAction(action);
  };
  const closeAction = () => {
    setActiveAction(undefined);
    requestAnimationFrame(
      () => actionTrigger.current?.isConnected && actionTrigger.current.focus(),
    );
    void load()
      .then(() => setTimelineRefresh((value) => value + 1))
      .catch(() => setError('Could not refresh this order. Reload the page for its latest state.'));
  };
  const actionSaved = async () => {
    await load();
    setTimelineRefresh((value) => value + 1);
    setNotice('Order updated.');
  };
  const closeRefundReconciliation = () => {
    setPendingRefundId(undefined);
    requestAnimationFrame(
      () => actionTrigger.current?.isConnected && actionTrigger.current.focus(),
    );
  };

  const mutate = async (key: string, url: string, init: RequestInit): Promise<boolean> => {
    setBusy(key);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await adminApiFetch(url, init);
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
    return mutate(`printing:${action}`, `${apiBase}/${encodeURIComponent(orderNumber)}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'SUBMIT_FULFILLMENT_GROUP', fulfillmentGroupId: groupId }),
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
        <AdminFeedback tone="error" onDismiss={() => setError(undefined)}>
          {error}
        </AdminFeedback>
      ) : null}
      {notice ? (
        <AdminFeedback tone="success" onDismiss={() => setNotice(undefined)}>
          {notice}
        </AdminFeedback>
      ) : null}
      {order ? (
        <>
          <header className="order-detail-heading">
            <div>
              <h1>{order.orderNumber}</h1>
              <div className="order-detail-meta">
                <span>
                  {new Date(order.createdAt).toLocaleString('en-US')} · {order.salesChannel}
                </span>
                <OrderStatusBadges
                  payment={order.paymentState}
                  printing={order.printingState}
                  fulfillment={order.fulfillmentState}
                />
                {order.archived ? <span className="order-layer-badge">Archived</span> : null}
              </div>
            </div>
            <OrderActionsMenu
              eligibility={order.eligibility}
              recovery={order.actionRecovery}
              pending={pendingActions}
              onSelect={openAction}
            />
          </header>

          <div className="order-detail-grid">
            <div className="order-detail-main">
              {order.groups.map((group) => (
                <section className="order-provider-group" key={group.id}>
                  <OrderFulfillmentGroup
                    group={group}
                    {...(order.eligibility.actions.return &&
                    order.returnableItems.some(
                      (item) =>
                        item.returnableQuantity > 0 &&
                        group.items.some((groupItem) => groupItem.id === item.orderItemId),
                    )
                      ? { onReturn: () => openAction('return') }
                      : {})}
                  />
                  <OrderPrintingSummary group={group} onOpen={() => setPrintingGroupId(group.id)} />
                </section>
              ))}
              {!order.groups.length ? (
                <article className="order-detail-card">
                  <p className="order-empty-copy">No fulfillment groups have been created.</p>
                </article>
              ) : null}
              <OrderPaymentSummary
                order={order}
                onRefund={() => openAction('refund')}
                {...(order.actionRecovery.canResume &&
                (order.amountDueCents > 0 || order.actionRecovery.additionalPayment)
                  ? {
                      onCollectPayment: () => {
                        actionTrigger.current = document.activeElement as HTMLElement | null;
                        setCollectingPayment(true);
                      },
                    }
                  : {})}
                {...(order.actionRecovery.canResume
                  ? {
                      onReconcileRefund: (refund: OrderDetail['pendingRefunds'][number]) => {
                        actionTrigger.current = document.activeElement as HTMLElement | null;
                        setPendingRefundId(refund.id);
                      },
                    }
                  : {})}
              />
              {order.returns.length ? (
                <article className="order-detail-card">
                  <header className="order-card-header">
                    <h2>Returns</h2>
                  </header>
                  <div className="order-return-history">
                    {order.returns.map((returned) => (
                      <div key={returned.id}>
                        <span>
                          <strong>
                            {returned.items.reduce((sum, item) => sum + item.quantity, 0)} item(s)
                          </strong>
                          <small>
                            {returned.reasonCode.replaceAll('_', ' ').toLowerCase()} ·{' '}
                            {new Date(returned.createdAt).toLocaleDateString('en-US')}
                          </small>
                        </span>
                        <span className="order-return-state-actions">
                          <span className="order-layer-badge">
                            {returned.state.replaceAll('_', ' ').toLowerCase()}
                          </span>
                          {canManageReturn(
                            apiBase,
                            order.orderNumber,
                            returned,
                            order.actionRecovery.canResume,
                          ) ? (
                            <button
                              type="button"
                              className="order-action-button"
                              onClick={() => {
                                actionTrigger.current =
                                  document.activeElement as HTMLElement | null;
                                setManagedReturnId(returned.id);
                              }}
                            >
                              Manage
                            </button>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              ) : null}
              {order.cancellation && !['SUCCEEDED'].includes(order.cancellation.status) ? (
                <article className="order-detail-card">
                  <div className="order-cancellation-notice">
                    <div>
                      <strong>Cancellation {order.cancellation.status.toLowerCase()}</strong>
                      <p>Review the timeline for provider outcomes and unresolved work.</p>
                    </div>
                    {order.actionRecovery?.cancellation ? (
                      <button
                        className="order-action-button"
                        type="button"
                        onClick={() => openAction('recoverCancellation')}
                      >
                        Review cancellation
                      </button>
                    ) : null}
                  </div>
                </article>
              ) : null}
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
          {activeAction ? (
            <OrderActionHost
              key={`${order.orderNumber}-${activeAction}`}
              order={order}
              action={activeAction}
              apiBase={apiBase}
              onClose={closeAction}
              onSaved={actionSaved}
            />
          ) : null}
          {pendingRefund ? (
            <PendingRefundReconciliationModal
              order={order}
              refund={pendingRefund}
              apiBase={apiBase}
              onClose={closeRefundReconciliation}
              onSaved={actionSaved}
            />
          ) : null}
          {managedReturn ? (
            <ManageReturnModal
              order={order}
              returned={managedReturn}
              apiBase={apiBase}
              onClose={() => {
                setManagedReturnId(undefined);
                requestAnimationFrame(
                  () => actionTrigger.current?.isConnected && actionTrigger.current.focus(),
                );
              }}
              onSaved={actionSaved}
            />
          ) : null}
          {collectingPayment ? (
            <CollectPaymentModal
              order={order}
              apiBase={apiBase}
              onClose={() => {
                setCollectingPayment(false);
                requestAnimationFrame(
                  () => actionTrigger.current?.isConnected && actionTrigger.current.focus(),
                );
              }}
              onSaved={actionSaved}
            />
          ) : null}
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

export function canManageReturn(
  apiBase: string,
  orderNumber: string,
  returned: OrderDetail['returns'][number],
  canResume: boolean,
): boolean {
  const path = `${apiBase}/${encodeURIComponent(orderNumber)}/returns/${encodeURIComponent(returned.id)}/transitions`;
  return returned.permittedTransitions.length > 0 || (canResume && hasOrderActionJournal(path));
}
