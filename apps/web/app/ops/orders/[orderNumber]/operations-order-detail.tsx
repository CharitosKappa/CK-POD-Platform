'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { OperationsActionDialog, type OperationsDialog } from './operations-action-dialog';

type Shipment = {
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  service: string | null;
  status: string;
};

type FulfillmentGroup = {
  id: string;
  groupKey: string;
  providerName: string;
  status: string;
  externalOrderId: string | null;
  itemCount: number;
  shipments: Shipment[];
};

type OperationalOrderDetail = {
  orderNumber: string;
  status: string;
  customerEmail: string;
  productName: string;
  colorCode: string;
  quantity: number;
  createdAt: string;
  latestReason: string | null;
  policyOutcome: string | null;
  policyFindingCodes: string[];
  policyRulesetId: string | null;
  fulfillmentGroups: FulfillmentGroup[];
};

function label(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ');
}

function directOrderAction(status: string): { label: string; action: string } | null {
  if (status === 'PAID') return { label: 'Start prepress review', action: 'START_PREPRESS_REVIEW' };
  if (status === 'ROUTING') return { label: 'Route order', action: 'ROUTE' };
  return null;
}

function reviewDialog(status: string): OperationsDialog | null {
  if (status === 'PREPRESS_REVIEW') return { kind: 'review', stage: 'PREPRESS' };
  if (status === 'COMPLIANCE_REVIEW') return { kind: 'review', stage: 'COMPLIANCE' };
  return null;
}

export function OperationsOrderDetail({ orderNumber }: Readonly<{ orderNumber: string }>) {
  const [order, setOrder] = useState<OperationalOrderDetail>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [dialog, setDialog] = useState<OperationsDialog>();

  const load = useCallback(async () => {
    const response = await fetch(`/api/ops/orders/${encodeURIComponent(orderNumber)}`);
    const payload = (await response.json()) as { order?: OperationalOrderDetail; error?: string };
    if (!response.ok || !payload.order)
      throw new Error(payload.error ?? 'Could not load this order.');
    setOrder(payload.order);
  }, [orderNumber]);

  useEffect(() => {
    setError(undefined);
    void load().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Could not load this order.'),
    );
  }, [load]);

  const act = async (
    action: string,
    payload: Record<string, string> = {},
    key = action,
  ): Promise<boolean> => {
    setBusy(key);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/ops/orders/${encodeURIComponent(orderNumber)}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Action failed.');
      await load();
      setNotice('Order updated.');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action failed.');
      return false;
    } finally {
      setBusy(undefined);
    }
  };

  if (!order && !error)
    return (
      <main className="ops-admin-page">
        <p className="ops-admin-feedback">Loading order…</p>
      </main>
    );

  const orderAction = order ? directOrderAction(order.status) : null;
  const reviewAction = order ? reviewDialog(order.status) : null;
  return (
    <main className="ops-admin-page ops-order-detail-page">
      <Link className="ops-order-breadcrumb" href="/ops/orders">
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
          <header className="ops-admin-page-header ops-order-header">
            <div>
              <div className="ops-order-title-row">
                <h1>{order.orderNumber}</h1>
                <span className="ops-status-chip neutral">{label(order.status)}</span>
              </div>
              <p>
                {new Date(order.createdAt).toLocaleString('en-US')} · {order.customerEmail}
              </p>
            </div>
            <div className="ops-order-header-actions">
              {['PAID', 'PREPRESS_REVIEW', 'COMPLIANCE_REVIEW', 'ROUTING'].includes(
                order.status,
              ) ? (
                <button
                  type="button"
                  className="ops-admin-secondary"
                  disabled={Boolean(busy)}
                  onClick={() => setDialog({ kind: 'hold' })}
                >
                  Hold order
                </button>
              ) : null}
              {order.status === 'ON_HOLD' ? (
                <button
                  type="button"
                  className="ops-admin-primary"
                  disabled={Boolean(busy)}
                  onClick={() => setDialog({ kind: 'resume' })}
                >
                  Resume order
                </button>
              ) : null}
              {reviewAction ? (
                <button
                  type="button"
                  className="ops-admin-primary"
                  disabled={Boolean(busy)}
                  onClick={() => setDialog(reviewAction)}
                >
                  Review order
                </button>
              ) : null}
              {orderAction ? (
                <button
                  type="button"
                  className="ops-admin-primary"
                  disabled={Boolean(busy)}
                  onClick={() => void act(orderAction.action)}
                >
                  {busy === orderAction.action ? 'Updating…' : orderAction.label}
                </button>
              ) : null}
            </div>
          </header>
          <section className="ops-order-summary-card">
            <div>
              <span>Product</span>
              <strong>{order.productName}</strong>
            </div>
            <div>
              <span>Color</span>
              <strong>{order.colorCode}</strong>
            </div>
            <div>
              <span>Quantity</span>
              <strong>{order.quantity}</strong>
            </div>
            <div>
              <span>Customer</span>
              <strong>{order.customerEmail}</strong>
            </div>
          </section>
          <section className="ops-detail-card">
            <header>
              <h2>Review</h2>
              <span>
                {order.policyOutcome ? `Policy: ${order.policyOutcome}` : 'Awaiting review'}
              </span>
            </header>
            {order.latestReason || order.policyFindingCodes.length ? (
              <p className="ops-review-callout">
                {order.latestReason?.replaceAll('_', ' ') ??
                  order.policyFindingCodes.map((code) => code.replaceAll('_', ' ')).join(', ')}
              </p>
            ) : (
              <p className="ops-muted-copy">No review finding is currently recorded.</p>
            )}
          </section>
          <section className="ops-detail-card">
            <header>
              <h2>Fulfillment groups</h2>
              <span>
                {order.fulfillmentGroups.length} group
                {order.fulfillmentGroups.length === 1 ? '' : 's'}
              </span>
            </header>
            <div className="ops-group-list">
              {order.fulfillmentGroups.map((group) => (
                <article key={group.id} className="ops-group-card">
                  <div className="ops-group-heading">
                    <div>
                      <h3>{group.providerName}</h3>
                      <p>
                        {group.groupKey} · {group.itemCount} item{group.itemCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <span className="ops-status-chip neutral">{label(group.status)}</span>
                  </div>
                  <dl className="ops-group-facts">
                    <div>
                      <dt>Readiness</dt>
                      <dd>
                        {group.status === 'READY_FOR_PRODUCTION' ? 'Ready' : label(group.status)}
                      </dd>
                    </div>
                    <div>
                      <dt>External order</dt>
                      <dd>{group.externalOrderId ?? 'Not submitted'}</dd>
                    </div>
                  </dl>
                  <div className="ops-group-actions">
                    {group.status === 'PENDING' ? (
                      <button
                        type="button"
                        className="ops-admin-secondary"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void act(
                            'EVALUATE_FULFILLMENT_GROUP',
                            { fulfillmentGroupId: group.id },
                            `evaluate:${group.id}`,
                          )
                        }
                      >
                        {busy === `evaluate:${group.id}` ? 'Evaluating…' : 'Evaluate readiness'}
                      </button>
                    ) : null}
                    {group.status === 'READY_FOR_PRODUCTION' ? (
                      <button
                        type="button"
                        className="ops-admin-primary"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void act(
                            'SUBMIT_FULFILLMENT_GROUP',
                            { fulfillmentGroupId: group.id },
                            `submit:${group.id}`,
                          )
                        }
                      >
                        {busy === `submit:${group.id}` ? 'Submitting…' : 'Submit group'}
                      </button>
                    ) : null}
                  </div>
                  {group.shipments.length ? (
                    <div className="ops-shipment-list">
                      {group.shipments.map((shipment, index) => (
                        <div key={`${shipment.trackingNumber ?? 'shipment'}-${index}`}>
                          <strong>{shipment.carrier ?? 'Shipment'}</strong>
                          <span>{shipment.service ?? shipment.status}</span>
                          {shipment.trackingUrl ? (
                            <a href={shipment.trackingUrl} target="_blank" rel="noreferrer">
                              {shipment.trackingNumber ?? 'Track shipment'}
                            </a>
                          ) : (
                            <span>{shipment.trackingNumber ?? 'Tracking pending'}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
              {!order.fulfillmentGroups.length ? (
                <p className="ops-admin-empty">No fulfillment groups have been created yet.</p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
      {dialog ? (
        <OperationsActionDialog
          dialog={dialog}
          busy={Boolean(busy)}
          onClose={() => setDialog(undefined)}
          onSubmit={(submission) => {
            void act(submission.action, submission.payload, `dialog:${dialog.kind}`).then(
              (succeeded) => {
                if (succeeded) setDialog(undefined);
              },
            );
          }}
        />
      ) : null}
    </main>
  );
}
