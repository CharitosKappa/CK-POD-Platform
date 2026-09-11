'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Customer = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  customerSince: string;
  orderCount: number;
  totalSpentCents: number;
  creditBalance: number;
  lastOrderAt: string | null;
  savedDesignCount: number;
  marketingConsent: 'UNKNOWN';
  addresses: Array<{
    id: string;
    recipientName: string;
    line1: string;
    line2: string | null;
    city: string;
    stateCode: string;
    postalCode: string;
    countryCode: string;
    phone: string | null;
    isDefault: boolean;
    source: 'SAVED' | 'ORDER';
  }>;
  orders: Array<{
    orderNumber: string;
    status: string;
    itemCount: number;
    totalCents: number;
    createdAt: string;
  }>;
  credits: Array<{
    id: string;
    entryType: string;
    amount: number;
    balanceAfter: number;
    createdAt: string;
  }>;
  tags: string[];
  timeline: Array<{ id: string; eventType: string; body: string | null; createdAt: string }>;
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function statusLabel(status: string): string {
  return status.toLowerCase().replaceAll('_', ' ');
}
function statusTone(status: string): string {
  if (['DELIVERED', 'SHIPPED'].includes(status)) return 'ready';
  if (['ON_HOLD', 'FAILED', 'CANCELLED'].includes(status)) return 'attention';
  if (['PAID', 'PREPRESS_REVIEW', 'COMPLIANCE_REVIEW'].includes(status)) return 'review';
  return 'neutral';
}

export function OperationsCustomerDetail({
  customerId,
  apiBase = '/api/ops/customers',
  pageBase = '/ops/customers',
  ordersBase = '/ops/orders',
}: Readonly<{ customerId: string; apiBase?: string; pageBase?: string; ordersBase?: string }>) {
  const [customer, setCustomer] = useState<Customer>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState<'note' | 'tags'>();
  const [feedback, setFeedback] = useState<string>();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(undefined);
      try {
        const response = await fetch(`${apiBase}/${encodeURIComponent(customerId)}`, {
          ...(signal ? { signal } : {}),
        });
        const payload = (await response.json()) as { customer?: Customer; error?: string };
        if (!response.ok || !payload.customer)
          throw new Error(payload.error ?? 'Could not load customer.');
        setCustomer(payload.customer);
        setTagDraft(payload.customer.tags.join(', '));
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Could not load customer.');
      } finally {
        setLoading(false);
      }
    },
    [apiBase, customerId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function saveNote() {
    if (!note.trim()) return;
    setSaving('note');
    setFeedback(undefined);
    try {
      const response = await fetch(`${apiBase}/${encodeURIComponent(customerId)}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: note }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not save note.');
      setNote('');
      setFeedback('Internal note added.');
      await load();
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Could not save note.');
    } finally {
      setSaving(undefined);
    }
  }

  async function saveTags() {
    const tags = tagDraft
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    setSaving('tags');
    setFeedback(undefined);
    try {
      const response = await fetch(`${apiBase}/${encodeURIComponent(customerId)}/tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tags }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not save tags.');
      setFeedback('Customer tags updated.');
      await load();
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Could not save tags.');
    } finally {
      setSaving(undefined);
    }
  }

  if (loading && !customer)
    return (
      <main className="ops-admin-page">
        <p className="ops-admin-feedback">Loading customer…</p>
      </main>
    );
  if (error && !customer)
    return (
      <main className="ops-admin-page">
        <Link href={pageBase} className="ops-customer-back">
          ‹ Customers
        </Link>
        <p className="ops-admin-feedback is-error" role="alert">
          {error}
        </p>
      </main>
    );
  if (!customer) return null;

  return (
    <main className="ops-admin-page ops-customer-detail-page">
      <Link href={pageBase} className="ops-customer-back">
        ‹ Customers
      </Link>
      <header className="ops-customer-header-card">
        <div className="ops-customer-identity">
          <span>{initials(customer.name)}</span>
          <div>
            <h1>{customer.name}</h1>
            <p>
              {customer.email} · Customer since {date.format(new Date(customer.customerSince))}
            </p>
          </div>
        </div>
      </header>
      <section className="ops-customer-metrics" aria-label="Customer commercial summary">
        <div>
          <strong>{money.format(customer.totalSpentCents / 100)}</strong>
          <span>Total spent</span>
        </div>
        <div>
          <strong>{customer.orderCount}</strong>
          <span>Orders</span>
        </div>
        <div>
          <strong>{customer.creditBalance}</strong>
          <span>Design credits available</span>
        </div>
        <div>
          <strong>
            {customer.lastOrderAt ? date.format(new Date(customer.lastOrderAt)) : '—'}
          </strong>
          <span>Last order</span>
        </div>
      </section>
      {feedback ? (
        <p className="ops-admin-feedback" role="status">
          {feedback}
        </p>
      ) : null}
      {error ? (
        <p className="ops-admin-feedback is-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="ops-customer-detail-grid">
        <section className="ops-customer-card ops-customer-orders">
          <h2>Orders</h2>
          {customer.orders.length ? (
            customer.orders.map((order) => (
              <div className="ops-customer-order" key={order.orderNumber}>
                <div>
                  <Link href={`${ordersBase}/${encodeURIComponent(order.orderNumber)}`}>
                    {order.orderNumber}
                  </Link>
                  <span>
                    {order.itemCount} item{order.itemCount === 1 ? '' : 's'} ·{' '}
                    {date.format(new Date(order.createdAt))}
                  </span>
                </div>
                <div>
                  <span className={`ops-status-chip ${statusTone(order.status)}`}>
                    {statusLabel(order.status)}
                  </span>
                  <strong>{money.format(order.totalCents / 100)}</strong>
                </div>
              </div>
            ))
          ) : (
            <p className="ops-admin-empty">No orders yet.</p>
          )}
        </section>
        <aside className="ops-customer-side-stack">
          <section className="ops-customer-card">
            <h2>Customer details</h2>
            <dl className="ops-customer-details">
              <div>
                <dt>Account</dt>
                <dd>
                  {customer.firstName || customer.lastName
                    ? 'Passwordless account'
                    : 'No profile details yet'}
                </dd>
              </div>
              <div>
                <dt>Marketing</dt>
                <dd>
                  {customer.marketingConsent === 'UNKNOWN'
                    ? 'Not recorded'
                    : customer.marketingConsent}
                </dd>
              </div>
              <div>
                <dt>Saved designs</dt>
                <dd>{customer.savedDesignCount}</dd>
              </div>
            </dl>
            {customer.addresses[0] ? (
              <div className="ops-customer-address">
                <span>
                  {customer.addresses[0].isDefault
                    ? 'Default address'
                    : 'Most recent delivery address'}
                </span>
                <b>{customer.addresses[0].recipientName}</b>
                <p>
                  {customer.addresses[0].line1}
                  {customer.addresses[0].line2 ? `, ${customer.addresses[0].line2}` : ''}
                  <br />
                  {customer.addresses[0].city}, {customer.addresses[0].stateCode}{' '}
                  {customer.addresses[0].postalCode}
                </p>
              </div>
            ) : null}
          </section>
          <section className="ops-customer-card">
            <h2>Tags</h2>
            <input
              className="ops-customer-tag-input"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder="vip, repeat buyer"
            />
            <button
              className="ops-admin-secondary"
              type="button"
              onClick={() => void saveTags()}
              disabled={saving === 'tags'}
            >
              {saving === 'tags' ? 'Saving…' : 'Save tags'}
            </button>
          </section>
        </aside>
      </section>
      <section className="ops-customer-detail-grid ops-customer-lower-grid">
        <section className="ops-customer-card">
          <h2>Design credit history</h2>
          {customer.credits.length ? (
            <div className="ops-customer-ledger">
              {customer.credits.map((entry) => (
                <div key={entry.id}>
                  <span>{entry.entryType.toLowerCase().replaceAll('_', ' ')}</span>
                  <span>
                    {entry.amount > 0 ? '+' : ''}
                    {entry.amount} · balance {entry.balanceAfter}
                  </span>
                  <time>{dateTime.format(new Date(entry.createdAt))}</time>
                </div>
              ))}
            </div>
          ) : (
            <p className="ops-admin-empty">No design-credit activity yet.</p>
          )}
        </section>
        <section className="ops-customer-card">
          <h2>Internal timeline</h2>
          <div className="ops-customer-note-form">
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add an internal note"
              maxLength={2000}
            />
            <button
              className="ops-admin-secondary"
              type="button"
              onClick={() => void saveNote()}
              disabled={!note.trim() || saving === 'note'}
            >
              {saving === 'note' ? 'Adding…' : 'Add note'}
            </button>
          </div>
          {customer.timeline.length ? (
            <div className="ops-customer-timeline">
              {customer.timeline.map((entry) => (
                <div key={entry.id}>
                  <b>{timelineLabel(entry.eventType)}</b>
                  {entry.body ? <p>{entry.body}</p> : null}
                  <time>{dateTime.format(new Date(entry.createdAt))}</time>
                </div>
              ))}
            </div>
          ) : (
            <p className="ops-admin-empty">No internal activity yet.</p>
          )}
        </section>
      </section>
    </main>
  );
}

function initials(name: string): string {
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
function timelineLabel(eventType: string): string {
  if (eventType === 'NOTE' || eventType === 'LEGACY_NOTE') return 'Internal note';
  if (eventType === 'TAGS_UPDATED') return 'Customer tags updated';
  return 'Customer profile created';
}
