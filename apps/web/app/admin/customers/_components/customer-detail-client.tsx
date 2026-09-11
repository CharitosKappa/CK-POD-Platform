'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { customerDisplayName, customerDuration } from './customer-detail-format';
import { CustomerDetailModal, type CustomerDetailModalName } from './customer-detail-modals';
import { CustomerTimeline } from './customer-detail-timeline';
import type { CustomerDetail } from './customer-types';

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
  const [customer, setCustomer] = useState<CustomerDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [note, setNote] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState<'note' | 'tags'>();
  const [modal, setModal] = useState<CustomerDetailModalName>();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(undefined);
      try {
        const response = await fetch(`/api/admin/customers/${encodeURIComponent(customerId)}`, {
          ...(signal ? { signal } : {}),
        });
        const payload = (await response.json()) as { customer?: CustomerDetail; error?: string };
        if (!response.ok || !payload.customer)
          throw new Error(payload.error ?? 'Could not load customer.');
        setCustomer(payload.customer);
        setTagDraft(payload.customer.tags.join(', '));
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Could not load customer.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
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

  async function saveNote() {
    if (!note.trim()) return;
    setSaving('note');
    setFeedback(undefined);
    try {
      const response = await fetch(`/api/admin/customers/${customerId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: note }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not add note.');
      setNote('');
      setFeedback('Internal note added.');
      await load();
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Could not add note.');
    } finally {
      setSaving(undefined);
    }
  }
  async function saveTags() {
    setSaving('tags');
    setFeedback(undefined);
    try {
      const tags = tagDraft
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      const response = await fetch(`/api/admin/customers/${customerId}/tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tags }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not update tags.');
      setFeedback('Customer tags updated.');
      await load();
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Could not update tags.');
    } finally {
      setSaving(undefined);
    }
  }

  async function handleModalSaved(message: string) {
    setFeedback(message);
    await load();
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
        <button
          className="customer-button primary"
          onClick={() => setModal('customer')}
          type="button"
        >
          Edit customer
        </button>
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
            <Metric label="Credits" value={String(customer.creditBalance)} />
            <Metric label="Return rate" value={`${customer.returnRate}%`} />
          </section>
          <section className="customer-card customer-latest-order-card">
            <header className="customer-latest-order-section-heading">
              <h2>Last order placed</h2>
              <Link href={`/admin/orders?q=${encodeURIComponent(customer.email)}`}>
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
                    <p>{dateTime.format(new Date(latestOrder.createdAt))} from Online store</p>
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
            <CustomerTimeline entries={customer.timeline} />
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
        <aside className="customer-detail-side">
          <section className="customer-card">
            <header className="customer-card-header">
              <div>
                <p>Profile</p>
                <h2>Customer</h2>
              </div>
              <button onClick={() => setModal('customer')} type="button">
                Edit
              </button>
            </header>
            <dl className="customer-info-list">
              <Info label="Email" value={customer.email} />
              <Info label="Phone" value={customer.phone ?? 'Not provided'} />
              <Info label="Email marketing" value={marketingLabel(customer.emailMarketingStatus)} />
              <Info label="SMS marketing" value={marketingLabel(customer.smsMarketingStatus)} />
            </dl>
          </section>
          <section className="customer-card">
            <header className="customer-card-header">
              <div>
                <p>Shipping</p>
                <h2>Default address</h2>
              </div>
              <button onClick={() => setModal('address')} type="button">
                Manage
              </button>
            </header>
            {address ? (
              <address className="customer-address">
                <strong>{address.recipientName}</strong>
                <span>{address.line1}</span>
                {address.line2 ? <span>{address.line2}</span> : null}
                <span>
                  {address.city}
                  {address.stateCode ? `, ${address.stateCode}` : ''} {address.postalCode}
                </span>
                <span>{address.countryCode}</span>
              </address>
            ) : (
              <p className="customer-empty-inline">No address saved.</p>
            )}
          </section>
          <section className="customer-card customer-note-side-card">
            <header className="customer-card-header">
              <div>
                <p>Private to staff</p>
                <h2>Note</h2>
              </div>
            </header>
            <div>
              <label className="sr-only" htmlFor="customer-note">
                Internal note
              </label>
              <textarea
                id="customer-note"
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add context for your team…"
              />
              <button
                className="customer-button secondary"
                disabled={!note.trim() || saving === 'note'}
                onClick={() => void saveNote()}
                type="button"
              >
                {saving === 'note' ? 'Adding…' : 'Add note'}
              </button>
            </div>
          </section>
          <section className="customer-card customer-tags-card">
            <header className="customer-card-header">
              <div>
                <p>Organization</p>
                <h2>Tags</h2>
              </div>
            </header>
            <label htmlFor="customer-tags">Comma-separated tags</label>
            <input
              id="customer-tags"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder="VIP, creator"
            />
            <button
              className="customer-button secondary"
              type="button"
              disabled={saving === 'tags'}
              onClick={() => void saveTags()}
            >
              {saving === 'tags' ? 'Saving…' : 'Save tags'}
            </button>
          </section>
          <section className="customer-card">
            <header className="customer-card-header">
              <div>
                <p>Creative history</p>
                <h2>Design activity</h2>
              </div>
            </header>
            <dl className="customer-info-list">
              <Info label="Saved designs" value={String(customer.savedDesignCount)} />
              <Info
                label="Last created"
                value={
                  customer.lastDesignAt
                    ? date.format(new Date(customer.lastDesignAt))
                    : 'No designs yet'
                }
              />
            </dl>
          </section>
        </aside>
      </div>
      {modal ? (
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
function Info({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
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
function marketingLabel(value: string) {
  if (value === 'SUBSCRIBED') return 'Subscribed';
  if (value === 'NOT_SUBSCRIBED') return 'Not subscribed';
  return 'Not recorded';
}
