'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  customerColumns as allCustomerColumns,
  readAdminPreferences,
  writeAdminPreferences,
  type CustomerColumn,
} from '../../../../lib/admin-preferences';
import type {
  CustomerListItem,
  CustomerListResponse,
  CustomerSort,
  CustomerView,
} from './customer-types';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const views: Array<[CustomerView, string]> = [
  ['ALL', 'All'],
  ['NEW', 'New'],
  ['RETURNING', 'Returning'],
  ['HIGH_VALUE', 'High value'],
  ['EMAIL_SUBSCRIBERS', 'Email subscribers'],
];
const columnLabels: Record<CustomerColumn, string> = {
  subscription: 'Email subscription',
  location: 'Location',
  orders: 'Orders',
  spent: 'Amount spent',
  lastOrder: 'Last order',
  tags: 'Tags',
};

export function AdminCustomersClient() {
  const [result, setResult] = useState<CustomerListResponse>();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [view, setView] = useState<CustomerView>('ALL');
  const [sort, setSort] = useState<CustomerSort>('LAST_SEEN_DESC');
  const [page, setPage] = useState(1);
  const [hasOrders, setHasOrders] = useState(false);
  const [subscription, setSubscription] = useState('');
  const [location, setLocation] = useState('');
  const [columns, setColumns] = useState<CustomerColumn[]>([...allCustomerColumns]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [bulkOpen, setBulkOpen] = useState<'ADD' | 'REMOVE'>();
  const [bulkTags, setBulkTags] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = readAdminPreferences(window.localStorage);
    setColumns(saved.customerColumns);
    setView(saved.customerView);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [debouncedQuery, view, sort, hasOrders, subscription, location]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams({ page: String(page), limit: '30', sort, view });
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (hasOrders) params.set('minOrders', '1');
      if (subscription) params.set('emailMarketingStatus', subscription);
      if (location.trim()) params.set('location', location.trim());
      setLoading(true);
      setError(undefined);
      try {
        const response = await fetch(`/api/admin/customers?${params}`, {
          ...(signal ? { signal } : {}),
        });
        const payload = (await response.json()) as CustomerListResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Could not load customers.');
        setResult(payload);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Could not load customers.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, sort, view, debouncedQuery, hasOrders, subscription, location],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function changeView(next: CustomerView) {
    setView(next);
    const preferences = readAdminPreferences(window.localStorage);
    writeAdminPreferences(window.localStorage, { ...preferences, customerView: next });
  }
  function toggleColumn(column: CustomerColumn) {
    const next = columns.includes(column)
      ? columns.filter((item) => item !== column)
      : [...columns, column];
    setColumns(next);
    const preferences = readAdminPreferences(window.localStorage);
    writeAdminPreferences(window.localStorage, { ...preferences, customerColumns: next });
  }
  function toggleCustomer(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePage() {
    const ids = result?.customers.map((customer) => customer.id) ?? [];
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(ids));
  }
  async function exportCustomers(customerIds: string[] = [...selected]) {
    if (!customerIds.length) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await fetch('/api/admin/customers/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerIds }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? 'Could not export customers.');
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(href);
      setFeedback(`${customerIds.length} customers exported.`);
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Could not export customers.');
    } finally {
      setBusy(false);
    }
  }
  async function applyBulkTags() {
    const tags = bulkTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (!bulkOpen || !tags.length) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await fetch('/api/admin/customers/bulk-tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerIds: [...selected], tags, operation: bulkOpen }),
      });
      const payload = (await response.json()) as { updated?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not update tags.');
      setFeedback(`Tags updated for ${payload.updated ?? selected.size} customers.`);
      setBulkOpen(undefined);
      setBulkTags('');
      await load();
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Could not update tags.');
    } finally {
      setBusy(false);
    }
  }

  const allOnPageSelected = useMemo(
    () =>
      !!result?.customers.length && result.customers.every((customer) => selected.has(customer.id)),
    [result, selected],
  );
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;

  return (
    <main className="customer-admin-page">
      <header className="customer-page-heading">
        <div>
          <p>Audience</p>
          <h1>Customers</h1>
          <span>Know who buys, returns and stays connected.</span>
        </div>
        <div className="customer-heading-actions">
          <button
            className="customer-button secondary"
            type="button"
            disabled={!result?.customers.length || busy}
            onClick={() => {
              void exportCustomers(result?.customers.map((customer) => customer.id) ?? []);
            }}
          >
            Export page
          </button>
          <Link className="customer-button primary" href="/admin/customers/new">
            Add customer
          </Link>
        </div>
      </header>

      <section className="customer-metric-strip" aria-label="Customer performance">
        <Metric
          label="Total customers"
          value={result?.metrics.totalCustomers.toLocaleString('en-US') ?? '—'}
          caption="Known customer profiles"
        />
        <Metric
          label="Returning customers"
          value={result ? `${result.metrics.returningPercentage}%` : '—'}
          caption="Among purchasing customers"
        />
        <Metric
          label="Average lifetime spend"
          value={result ? money.format(result.metrics.averageLifetimeSpendCents / 100) : '—'}
          caption="Per purchasing customer"
        />
        <Metric
          label="Email subscribers"
          value={result?.metrics.emailSubscribers.toLocaleString('en-US') ?? '—'}
          caption="Explicitly subscribed"
        />
      </section>

      <section className="customer-directory-card" aria-label="Customer directory">
        <nav className="customer-view-tabs" aria-label="Customer views">
          {views.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-current={view === value ? 'page' : undefined}
              onClick={() => changeView(value)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="customer-toolbar">
          <label className="customer-search">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">Search customers</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email, phone or address"
            />
          </label>
          <details className="customer-popover">
            <summary>Filters</summary>
            <div className="customer-popover-panel filter-panel">
              <label>
                <input
                  type="checkbox"
                  checked={hasOrders}
                  onChange={(event) => setHasOrders(event.target.checked)}
                />
                Has orders
              </label>
              <label>
                Email subscription
                <select
                  value={subscription}
                  onChange={(event) => setSubscription(event.target.value)}
                >
                  <option value="">Any</option>
                  <option value="SUBSCRIBED">Subscribed</option>
                  <option value="NOT_SUBSCRIBED">Not subscribed</option>
                  <option value="UNKNOWN">Unknown</option>
                </select>
              </label>
              <label>
                Location
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="City or country"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setHasOrders(false);
                  setSubscription('');
                  setLocation('');
                }}
              >
                Clear filters
              </button>
            </div>
          </details>
          <label className="customer-select-control">
            <span className="sr-only">Sort customers</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as CustomerSort)}>
              <option value="LAST_SEEN_DESC">Recently active</option>
              <option value="TOTAL_SPENT_DESC">Amount spent</option>
              <option value="ORDER_COUNT_DESC">Order count</option>
              <option value="NAME_ASC">Name A–Z</option>
            </select>
          </label>
          <details className="customer-popover">
            <summary>Columns</summary>
            <div className="customer-popover-panel columns-panel">
              {allCustomerColumns.map((column) => (
                <label key={column}>
                  <input
                    type="checkbox"
                    checked={columns.includes(column)}
                    onChange={() => toggleColumn(column)}
                  />
                  {columnLabels[column]}
                </label>
              ))}
            </div>
          </details>
        </div>

        {selected.size ? (
          <div className="customer-bulk-bar" role="region" aria-label="Bulk customer actions">
            <strong>{selected.size} selected</strong>
            <button type="button" onClick={() => setBulkOpen('ADD')}>
              Add tags
            </button>
            <button type="button" onClick={() => setBulkOpen('REMOVE')}>
              Remove tags
            </button>
            <button type="button" disabled={busy} onClick={() => void exportCustomers()}>
              Export selected
            </button>
            <button className="quiet" type="button" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        ) : null}
        {feedback ? (
          <p className="customer-feedback" role="status">
            {feedback}
          </p>
        ) : null}
        {error ? (
          <p className="customer-feedback error" role="alert">
            {error}{' '}
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </p>
        ) : null}

        <div className="customer-table-scroll" aria-busy={loading}>
          <table className="customer-directory-table">
            <thead>
              <tr>
                <th className="select">
                  <input
                    aria-label="Select all customers on this page"
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={togglePage}
                  />
                </th>
                <th>Customer</th>
                {columns.includes('subscription') ? <th>Email subscription</th> : null}
                {columns.includes('location') ? <th>Location</th> : null}
                {columns.includes('orders') ? <th>Orders</th> : null}
                {columns.includes('spent') ? <th>Amount spent</th> : null}
                {columns.includes('lastOrder') ? <th>Last order</th> : null}
                {columns.includes('tags') ? <th>Tags</th> : null}
              </tr>
            </thead>
            <tbody>
              {result?.customers.map((customer) => (
                <CustomerRow
                  key={customer.id}
                  customer={customer}
                  columns={columns}
                  checked={selected.has(customer.id)}
                  onToggle={() => toggleCustomer(customer.id)}
                />
              ))}
            </tbody>
          </table>
          {loading ? <div className="customer-table-state">Loading customer directory…</div> : null}
          {!loading && !error && result?.customers.length === 0 ? (
            <div className="customer-empty">
              <strong>
                {debouncedQuery || hasOrders || subscription || location
                  ? 'No customers match this view.'
                  : 'Your customer base starts here.'}
              </strong>
              <span>
                {debouncedQuery || hasOrders || subscription || location
                  ? 'Adjust the search or clear filters.'
                  : 'Add a customer manually or wait for the first checkout.'}
              </span>
              {!result.metrics.totalCustomers ? (
                <Link className="customer-button primary" href="/admin/customers/new">
                  Add customer
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
        <footer className="customer-pagination">
          <span>
            {result
              ? `Showing ${result.total ? (page - 1) * result.limit + 1 : 0}–${Math.min(page * result.limit, result.total)} of ${result.total}`
              : 'Loading…'}
          </span>
          <div>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => current - 1)}
              aria-label="Previous page"
            >
              ←
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
              aria-label="Next page"
            >
              →
            </button>
          </div>
        </footer>
      </section>

      {bulkOpen ? (
        <div
          className="customer-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setBulkOpen(undefined);
          }}
        >
          <section
            className="customer-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-title"
          >
            <h2 id="bulk-title">{bulkOpen === 'ADD' ? 'Add tags' : 'Remove tags'}</h2>
            <p>
              Apply to {selected.size} selected customer{selected.size === 1 ? '' : 's'}.
            </p>
            <label>
              Tags
              <input
                autoFocus
                value={bulkTags}
                onChange={(event) => setBulkTags(event.target.value)}
                placeholder="vip, repeat buyer"
              />
            </label>
            <div>
              <button
                className="customer-button secondary"
                type="button"
                onClick={() => setBulkOpen(undefined)}
              >
                Cancel
              </button>
              <button
                className="customer-button primary"
                type="button"
                disabled={!bulkTags.trim() || busy}
                onClick={() => void applyBulkTags()}
              >
                {busy ? 'Saving…' : 'Apply tags'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Metric({
  label,
  value,
  caption,
}: Readonly<{ label: string; value: string; caption: string }>) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </article>
  );
}

function CustomerRow({
  customer,
  columns,
  checked,
  onToggle,
}: Readonly<{
  customer: CustomerListItem;
  columns: CustomerColumn[];
  checked: boolean;
  onToggle: () => void;
}>) {
  return (
    <tr>
      <td className="select">
        <input
          aria-label={`Select ${customer.name}`}
          type="checkbox"
          checked={checked}
          onChange={onToggle}
        />
      </td>
      <td className="customer-identity-cell" data-label="Customer">
        <Link href={`/admin/customers/${encodeURIComponent(customer.id)}`}>{customer.name}</Link>
        <span>{customer.email}</span>
      </td>
      {columns.includes('subscription') ? (
        <td data-label="Email subscription">
          <span
            className={`customer-subscription ${customer.emailMarketingStatus === 'SUBSCRIBED' ? 'subscribed' : ''}`}
          >
            {statusLabel(customer.emailMarketingStatus)}
          </span>
        </td>
      ) : null}
      {columns.includes('location') ? (
        <td data-label="Location">{customer.location || '—'}</td>
      ) : null}
      {columns.includes('orders') ? <td data-label="Orders">{customer.orderCount}</td> : null}
      {columns.includes('spent') ? (
        <td data-label="Amount spent">
          <strong>{money.format(customer.totalSpentCents / 100)}</strong>
        </td>
      ) : null}
      {columns.includes('lastOrder') ? (
        <td data-label="Last order">
          {customer.lastOrderAt ? date.format(new Date(customer.lastOrderAt)) : '—'}
        </td>
      ) : null}
      {columns.includes('tags') ? (
        <td data-label="Tags">
          <div className="customer-tags">
            {customer.tags.length
              ? customer.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)
              : '—'}
          </div>
        </td>
      ) : null}
    </tr>
  );
}

function statusLabel(status: string) {
  if (status === 'SUBSCRIBED') return 'Subscribed';
  if (status === 'NOT_SUBSCRIBED') return 'Not subscribed';
  return 'Unknown';
}
