'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { customerDisplayName, customerDuration } from './customer-detail-format';
import { CustomerAddressManagerModal } from './customer-address-manager';
import { loadCustomerDetail, refreshCustomerAfterSave } from './customer-detail-loading';
import { CustomerDetailModal } from './customer-detail-modals';
import { CustomerDetailSidebar, type CustomerSidebarAction } from './customer-detail-sidebar';
import { CustomerTimeline } from './customer-detail-timeline';
import { StoreCreditAdjustmentModal } from './store-credit-adjustment-modal';
import { StoreCreditLedgerModal } from './store-credit-ledger-modal';
import type { CustomerDetail, CustomerTimelinePage } from './customer-types';
import { canManageCustomers, useAdminRole } from '../../admin-role';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function CustomerDetailClient({ customerId }: Readonly<{ customerId: string }>) {
  const customerActionsButton = useRef<HTMLButtonElement>(null);
  const canManage = canManageCustomers(useAdminRole());
  const [customer, setCustomer] = useState<CustomerDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [modal, setModal] = useState<CustomerSidebarAction>();
  const [timeline, setTimeline] = useState<CustomerTimelinePage>();
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string>();

  const load = useCallback(
    (signal?: AbortSignal) =>
      loadCustomerDetail({
        customerId,
        ...(signal ? { signal } : {}),
        setCustomer,
        setError,
        setLoading,
      }),
    [customerId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('saved')) setFeedback('Customer saved.');
  }, []);
  useEffect(() => {
    if (!customer) return;
    setTimeline({
      entries: customer.timeline,
      total: customer.timelineTotal,
      page: 1,
      limit: 10,
    });
  }, [customer]);

  async function loadTimelinePage(page: number) {
    setTimelineLoading(true);
    setTimelineError(undefined);
    try {
      const response = await fetch(
        `/api/admin/customers/${encodeURIComponent(customerId)}/timeline?page=${page}&limit=10`,
      );
      const payload = (await response.json()) as {
        timeline?: CustomerTimelinePage;
        error?: string;
      };
      if (!response.ok || !payload.timeline)
        throw new Error(payload.error ?? 'Could not load customer activity.');
      setTimeline(payload.timeline);
    } catch (timelinePageError) {
      setTimelineError(
        timelinePageError instanceof Error
          ? timelinePageError.message
          : 'Could not load customer activity.',
      );
    } finally {
      setTimelineLoading(false);
    }
  }

  async function handleModalSaved(message: string) {
    await refreshCustomerAfterSave(message, load, setFeedback);
  }

  if (loading && !customer)
    return (
      <main className="customer-admin-page">
        <p className="customer-feedback">Loading customer profile…</p>
      </main>
    );
  if (!customer)
    return (
      <main className="customer-admin-page">
        <Link className="customer-back-link" href="/admin/customers">
          ← Customers
        </Link>
        <p className="customer-feedback error" role="alert">
          {error ?? 'Customer not found.'}
        </p>
      </main>
    );
  const address = customer.addresses[0];
  const displayName = customerDisplayName(customer);
  const latestOrder = customer.orders[0];

  return (
    <main className="customer-admin-page customer-detail-page">
      <Link className="customer-back-link" href="/admin/customers">
        ← Customers
      </Link>
      <header className="customer-detail-heading">
        <div className="customer-detail-identity">
          <span aria-hidden="true">{initials(displayName)}</span>
          <div>
            <h1>{displayName}</h1>
            <p>
              Customer since {date.format(new Date(customer.customerSince))} (
              {customerDuration(new Date(customer.customerSince))})
              {address ? ` · ${address.city}, ${address.countryCode}` : ''}
            </p>
          </div>
        </div>
        {canManage ? (
          <button
            className="customer-button primary"
            onClick={() => setModal('customer')}
            type="button"
          >
            Edit customer
          </button>
        ) : null}
      </header>
      {feedback ? (
        <p className="customer-feedback" role="status">
          {feedback}
        </p>
      ) : null}
      {error ? (
        <p className="customer-feedback error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="customer-detail-grid">
        <div className="customer-detail-main">
          <section
            className="customer-card customer-detail-metrics"
            aria-label="Customer commercial summary"
          >
            <Metric label="Amount spent" value={money.format(customer.totalSpentCents / 100)} />
            <Metric label="Orders" value={String(customer.orderCount)} />
            <Metric
              label="Average order"
              value={money.format(customer.averageOrderValueCents / 100)}
            />
            <Metric label="Refunded order rate" value={`${customer.refundedOrderRate}%`} />
          </section>
          <section className="customer-card customer-latest-order-card">
            <header className="customer-latest-order-section-heading">
              <h2>Last order placed</h2>
              <Link href={`/admin/orders?customerId=${encodeURIComponent(customer.id)}`}>
                View all orders
              </Link>
            </header>
            {latestOrder ? (
              <article className="customer-latest-order">
                <header>
                  <div>
                    <div className="customer-latest-order-title">
                      <Link
                        className="customer-order-number"
                        href={`/admin/orders/${encodeURIComponent(latestOrder.orderNumber)}`}
                      >
                        {latestOrder.orderNumber}
                      </Link>
                      <span className={`commerce-status ${paymentTone(latestOrder.paymentStatus)}`}>
                        <span aria-hidden="true" />
                        {paymentStatusLabel(latestOrder.paymentStatus)}
                      </span>
                      <span className={`commerce-status ${statusTone(latestOrder.status)}`}>
                        <span aria-hidden="true" />
                        {fulfillmentStatusLabel(latestOrder.status)}
                      </span>
                    </div>
                    <p>{dateTime.format(new Date(latestOrder.createdAt))}</p>
                  </div>
                  <strong>{money.format(latestOrder.totalCents / 100)}</strong>
                </header>
                <div className="customer-latest-order-items">
                  {latestOrder.items.map((item, index) => (
                    <Link
                      href={`/admin/orders/${encodeURIComponent(latestOrder.orderNumber)}`}
                      key={`${latestOrder.orderNumber}-${item.productName}-${item.color}-${item.size}-${index}`}
                    >
                      <span className="customer-order-thumbnail" aria-hidden="true">
                        {item.imageUrl ? <img alt="" src={item.imageUrl} /> : <span>LIB</span>}
                      </span>
                      <span className="customer-order-product">
                        <strong>{item.productName}</strong>
                        <small>
                          {[item.color, item.size]
                            .filter((value) => value && value !== '—')
                            .join(' · ') || 'Custom variant'}
                        </small>
                      </span>
                      <span className="customer-order-quantity">× {item.quantity}</span>
                      <b>{money.format((item.unitPriceCents * item.quantity) / 100)}</b>
                    </Link>
                  ))}
                </div>
              </article>
            ) : (
              <p className="customer-empty-inline">No orders yet.</p>
            )}
          </section>
          <section className="customer-card">
            <header className="customer-card-header">
              <div>
                <p>Private to staff</p>
                <h2>Timeline</h2>
              </div>
            </header>
            <CustomerTimeline
              entries={timeline?.entries ?? customer.timeline}
              loading={timelineLoading}
              onPageChange={loadTimelinePage}
              page={timeline?.page ?? 1}
              total={timeline?.total ?? customer.timelineTotal}
              {...(timelineError ? { error: timelineError } : {})}
            />
          </section>
          {customer.credits.length ? (
            <details className="customer-card customer-credit-details">
              <summary>
                Design credit history <span>{customer.credits.length} entries</span>
              </summary>
              <div>
                {customer.credits.map((entry) => (
                  <p key={entry.id}>
                    <span>{statusLabel(entry.entryType)}</span>
                    <b>
                      {entry.amount > 0 ? '+' : ''}
                      {entry.amount} · balance {entry.balanceAfter}
                    </b>
                    <time>{dateTime.format(new Date(entry.createdAt))}</time>
                  </p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
        <CustomerDetailSidebar
          actionButtonRef={customerActionsButton}
          customer={customer}
          canManage={canManage}
          onAction={setModal}
        />
      </div>
      {modal === 'storeCreditLedger' ? (
        <StoreCreditLedgerModal
          customer={customer}
          onClose={() => setModal(undefined)}
          {...(canManage ? { onAdjust: () => setModal('storeCredit') } : {})}
        />
      ) : modal === 'storeCredit' ? (
        <StoreCreditAdjustmentModal
          customerId={customer.id}
          balanceCents={customer.storeCreditBalanceCents}
          onClose={() => setModal(undefined)}
          onSaved={handleModalSaved}
        />
      ) : modal === 'address' ? (
        <CustomerAddressManagerModal
          customer={customer}
          onClose={() => setModal(undefined)}
          onSaved={handleModalSaved}
          returnFocusRef={customerActionsButton}
        />
      ) : modal ? (
        <CustomerDetailModal
          key={modal}
          customer={customer}
          modal={modal}
          onClose={() => setModal(undefined)}
          onSaved={handleModalSaved}
        />
      ) : null}
    </main>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function initials(name: string) {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || 'C'
  );
}
function statusLabel(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}
function statusTone(status: string) {
  if (['DELIVERED', 'SHIPPED'].includes(status)) return 'is-paid';
  if (['FAILED', 'CANCELLED', 'ON_HOLD'].includes(status)) return 'is-alert';
  return '';
}
function paymentTone(status: string) {
  if (status === 'SUCCEEDED') return 'is-paid';
  if (['FAILED', 'CANCELLED'].includes(status)) return 'is-alert';
  return '';
}
function paymentStatusLabel(status: string) {
  if (status === 'SUCCEEDED') return 'Paid';
  return statusLabel(status);
}
function fulfillmentStatusLabel(status: string) {
  if (status === 'DELIVERED') return 'Delivered';
  if (status === 'SHIPPED') return 'Shipped';
  if (status === 'IN_PRODUCTION') return 'In production';
  if (status === 'SUBMITTED_TO_PRINTIFY') return 'Submitted';
  if (
    ['PAID', 'PREPRESS_REVIEW', 'COMPLIANCE_REVIEW', 'ROUTING', 'READY_FOR_PRODUCTION'].includes(
      status,
    )
  )
    return 'Unfulfilled';
  return statusLabel(status);
}
