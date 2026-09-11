'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  customerColumns as allCustomerColumns,
  readAdminPreferences,
  writeAdminPreferences,
  type CustomerColumn,
} from '../../../../lib/admin-preferences';
import type {
  CustomerExportSummary,
  CustomerListItem,
  CustomerListResponse,
  CustomerSort,
  CustomerView,
} from './customer-types';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const time = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const views: Array<[CustomerView, string]> = [
  ['ALL', 'All'],
  ['RECENTLY_ADDED', 'Recently added'],
  ['PROSPECTS', 'Prospects'],
  ['FIRST_TIME', 'First-time'],
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
  dateAdded: 'Date customer added',
  dateUpdated: 'Date customer updated',
};
const sortOptions: Array<[CustomerSort, string]> = [
  ['LAST_SEEN_DESC', 'Recently active'],
  ['NAME_ASC', 'Customer name A–Z'],
  ['NAME_DESC', 'Customer name Z–A'],
  ['EMAIL_ASC', 'Email A–Z'],
  ['EMAIL_DESC', 'Email Z–A'],
  ['EMAIL_MARKETING_ASC', 'Email subscription A–Z'],
  ['EMAIL_MARKETING_DESC', 'Email subscription Z–A'],
  ['LOCATION_ASC', 'Location A–Z'],
  ['LOCATION_DESC', 'Location Z–A'],
  ['ORDER_COUNT_ASC', 'Orders: low to high'],
  ['ORDER_COUNT_DESC', 'Orders: high to low'],
  ['TOTAL_SPENT_ASC', 'Amount spent: low to high'],
  ['TOTAL_SPENT_DESC', 'Amount spent: high to low'],
  ['LAST_ORDER_ASC', 'Last order: oldest first'],
  ['LAST_ORDER_DESC', 'Last order: newest first'],
  ['TAGS_ASC', 'Tags A–Z'],
  ['TAGS_DESC', 'Tags Z–A'],
  ['CUSTOMER_ADDED_ASC', 'Date customer added: oldest first'],
  ['CUSTOMER_ADDED_DESC', 'Date customer added: newest first'],
  ['CUSTOMER_UPDATED_ASC', 'Date customer updated: oldest first'],
  ['CUSTOMER_UPDATED_DESC', 'Date customer updated: newest first'],
];

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
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [exportJobs, setExportJobs] = useState<CustomerExportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [bulkOpen, setBulkOpen] = useState<'ADD' | 'REMOVE'>();
  const [bulkTags, setBulkTags] = useState('');
  const [busy, setBusy] = useState(false);
  const exportInFlight = useRef(false);

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
    setAllMatchingSelected(false);
    setExcluded(new Set());
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

  const loadExports = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/customer-exports');
      const payload = (await response.json()) as {
        exports?: CustomerExportSummary[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Could not load exports.');
      setExportJobs(payload.exports ?? []);
    } catch {
      // Customer loading remains usable if export-status refresh is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    void loadExports();
  }, [loadExports]);

  useEffect(() => {
    if (!exportJobs.some((job) => ['QUEUED', 'PROCESSING'].includes(job.status))) return;
    const timer = window.setInterval(() => void loadExports(), 3_000);
    return () => window.clearInterval(timer);
  }, [exportJobs, loadExports]);

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
    if (allMatchingSelected) {
      setExcluded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePage() {
    const ids = result?.customers.map((customer) => customer.id) ?? [];
    if (allMatchingSelected) {
      setExcluded((current) => {
        const next = new Set(current);
        const allSelected = ids.length > 0 && ids.every((id) => !next.has(id));
        for (const id of ids) {
          if (allSelected) next.add(id);
          else next.delete(id);
        }
        return next;
      });
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }
  function selectAllMatchingCustomers() {
    if (!result?.total) return;
    setAllMatchingSelected(true);
    setSelected(new Set());
    setExcluded(new Set());
  }
  function activeSelection(customerIds?: string[]) {
    if (customerIds) return { type: 'IDS' as const, customerIds };
    if (allMatchingSelected)
      return {
        type: 'FILTER' as const,
        filters: {
          view,
          ...(debouncedQuery ? { query: debouncedQuery } : {}),
          ...(hasOrders ? { minOrders: 1 } : {}),
          ...(subscription
            ? { emailMarketingStatus: subscription as 'UNKNOWN' | 'NOT_SUBSCRIBED' | 'SUBSCRIBED' }
            : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
        },
        ...(excluded.size ? { excludedCustomerIds: [...excluded] } : {}),
      };
    return { type: 'IDS' as const, customerIds: [...selected] };
  }
  async function exportCustomers(customerIds?: string[]) {
    if (exportInFlight.current) return;
    const selection = activeSelection(customerIds);
    const requestedCount = customerIds?.length ?? selectedCount;
    if (!requestedCount) return;
    exportInFlight.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await fetch('/api/admin/customers/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selection }),
      });
      if (response.status === 202) {
        const payload = (await response.json()) as {
          export?: CustomerExportSummary;
          error?: string;
        };
        if (!payload.export) throw new Error(payload.error ?? 'Could not queue customer export.');
        setExportJobs((current) => [
          payload.export!,
          ...current.filter((job) => job.id !== payload.export!.id),
        ]);
        setFeedback(
          `Export started for ${payload.export.totalCount.toLocaleString('en-US')} customers. You can safely leave this page.`,
        );
        return;
      }
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
      setFeedback(`${requestedCount.toLocaleString('en-US')} customers exported.`);
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Could not export customers.');
    } finally {
      exportInFlight.current = false;
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
        body: JSON.stringify({ selection: activeSelection(), tags, operation: bulkOpen }),
      });
      const payload = (await response.json()) as { updated?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not update tags.');
      setFeedback(`Tags updated for ${payload.updated ?? selectedCount} customers.`);
      setBulkOpen(undefined);
      setBulkTags('');
      clearSelection();
      await load();
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Could not update tags.');
    } finally {
      setBusy(false);
    }
  }

  const allOnPageSelected = useMemo(
    () =>
      !!result?.customers.length &&
      result.customers.every((customer) =>
        allMatchingSelected ? !excluded.has(customer.id) : selected.has(customer.id),
      ),
    [allMatchingSelected, excluded, result, selected],
  );
  const selectedCount = allMatchingSelected
    ? Math.max(0, (result?.total ?? 0) - excluded.size)
    : selected.size;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;

  function clearSelection() {
    setSelected(new Set());
    setAllMatchingSelected(false);
    setExcluded(new Set());
  }

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
          label="Repeat customer rate"
          value={result ? `${result.metrics.repeatCustomerRate}%` : '—'}
          caption="2+ orders among purchasers"
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
              {sortOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
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
          <details className="customer-popover customer-exports-popover">
            <summary>
              Exports
              {exportJobs.some((job) => job.status === 'READY') ? (
                <span aria-hidden="true" />
              ) : null}
            </summary>
            <ExportJobsPanel jobs={exportJobs} />
          </details>
        </div>

        {selectedCount ? (
          <div className="customer-bulk-bar" role="region" aria-label="Bulk customer actions">
            <strong>{selectedCount.toLocaleString('en-US')} selected</strong>
            {allOnPageSelected && result && !allMatchingSelected && selectedCount < result.total ? (
              <button
                className="select-all"
                type="button"
                disabled={busy}
                onClick={selectAllMatchingCustomers}
              >
                {`Select all (${result.total.toLocaleString('en-US')})`}
              </button>
            ) : null}
            {allMatchingSelected && result && selectedCount === result.total ? (
              <span className="all-selected">All customers in this view are selected</span>
            ) : null}
            <button type="button" disabled={busy} onClick={() => setBulkOpen('ADD')}>
              Add tags
            </button>
            <button type="button" disabled={busy} onClick={() => setBulkOpen('REMOVE')}>
              Remove tags
            </button>
            <button type="button" disabled={busy} onClick={() => void exportCustomers()}>
              Export selected
            </button>
            <button className="quiet" type="button" disabled={busy} onClick={clearSelection}>
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
                <SortableHeader
                  className="customer-name-column"
                  label="Customer name"
                  ascending="NAME_ASC"
                  descending="NAME_DESC"
                  sort={sort}
                  onSort={setSort}
                />
                <SortableHeader
                  className="customer-email-column"
                  label="Email"
                  ascending="EMAIL_ASC"
                  descending="EMAIL_DESC"
                  sort={sort}
                  onSort={setSort}
                />
                {columns.includes('subscription') ? (
                  <SortableHeader
                    className="customer-subscription-column"
                    label="Email subscription"
                    ascending="EMAIL_MARKETING_ASC"
                    descending="EMAIL_MARKETING_DESC"
                    sort={sort}
                    onSort={setSort}
                  />
                ) : null}
                {columns.includes('location') ? (
                  <SortableHeader
                    className="customer-location-column"
                    label="Location"
                    ascending="LOCATION_ASC"
                    descending="LOCATION_DESC"
                    sort={sort}
                    onSort={setSort}
                  />
                ) : null}
                {columns.includes('orders') ? (
                  <SortableHeader
                    className="customer-orders-column"
                    label="Orders"
                    ascending="ORDER_COUNT_ASC"
                    descending="ORDER_COUNT_DESC"
                    sort={sort}
                    onSort={setSort}
                  />
                ) : null}
                {columns.includes('spent') ? (
                  <SortableHeader
                    className="customer-spent-column"
                    label="Amount spent"
                    ascending="TOTAL_SPENT_ASC"
                    descending="TOTAL_SPENT_DESC"
                    sort={sort}
                    onSort={setSort}
                  />
                ) : null}
                {columns.includes('lastOrder') ? (
                  <SortableHeader
                    className="customer-last-order-column"
                    label="Last order"
                    ascending="LAST_ORDER_ASC"
                    descending="LAST_ORDER_DESC"
                    sort={sort}
                    onSort={setSort}
                  />
                ) : null}
                {columns.includes('tags') ? (
                  <SortableHeader
                    className="customer-tags-column"
                    label="Tags"
                    ascending="TAGS_ASC"
                    descending="TAGS_DESC"
                    sort={sort}
                    onSort={setSort}
                  />
                ) : null}
                {columns.includes('dateAdded') ? (
                  <SortableHeader
                    className="customer-date-added-column"
                    label="Date customer added"
                    ascending="CUSTOMER_ADDED_ASC"
                    descending="CUSTOMER_ADDED_DESC"
                    sort={sort}
                    onSort={setSort}
                  />
                ) : null}
                {columns.includes('dateUpdated') ? (
                  <SortableHeader
                    className="customer-date-updated-column"
                    label="Date customer updated"
                    ascending="CUSTOMER_UPDATED_ASC"
                    descending="CUSTOMER_UPDATED_DESC"
                    sort={sort}
                    onSort={setSort}
                  />
                ) : null}
              </tr>
            </thead>
            <tbody>
              {result?.customers.map((customer) => (
                <CustomerRow
                  key={customer.id}
                  customer={customer}
                  columns={columns}
                  checked={
                    allMatchingSelected ? !excluded.has(customer.id) : selected.has(customer.id)
                  }
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
              Apply to {selectedCount.toLocaleString('en-US')} selected customer
              {selectedCount === 1 ? '' : 's'}.
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

function ExportJobsPanel({ jobs }: Readonly<{ jobs: CustomerExportSummary[] }>) {
  return (
    <div className="customer-popover-panel customer-export-panel">
      <header>
        <strong>Recent exports</strong>
        <span>Ready files remain available for 7 days.</span>
      </header>
      {jobs.length ? (
        <div className="customer-export-list">
          {jobs.map((job) => {
            const progress = job.totalCount
              ? Math.min(100, Math.round((job.processedCount / job.totalCount) * 100))
              : 0;
            return (
              <article key={job.id}>
                <div>
                  <strong>{job.fileName}</strong>
                  <span>
                    {job.totalCount.toLocaleString('en-US')} customers ·{' '}
                    {formatCustomerTimestamp(job.createdAt)}
                  </span>
                </div>
                <span className={`customer-export-status ${job.status.toLowerCase()}`}>
                  {exportStatusLabel(job.status)}
                </span>
                {job.status === 'PROCESSING' || job.status === 'QUEUED' ? (
                  <div
                    className="customer-export-progress"
                    role="progressbar"
                    aria-label={`${job.fileName} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>
                ) : null}
                {job.status === 'READY' ? (
                  <a href={`/api/admin/customer-exports/${encodeURIComponent(job.id)}/download`}>
                    Download CSV
                  </a>
                ) : null}
                {job.status === 'FAILED' && job.failureReason ? (
                  <small>{job.failureReason}</small>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p>No background exports yet.</p>
      )}
    </div>
  );
}

function exportStatusLabel(status: CustomerExportSummary['status']) {
  if (status === 'QUEUED') return 'Queued';
  if (status === 'PROCESSING') return 'Processing';
  if (status === 'READY') return 'Ready';
  if (status === 'FAILED') return 'Failed';
  return 'Expired';
}

function SortableHeader({
  className,
  label,
  ascending,
  descending,
  sort,
  onSort,
}: Readonly<{
  className: string;
  label: string;
  ascending: CustomerSort;
  descending: CustomerSort;
  sort: CustomerSort;
  onSort: (sort: CustomerSort) => void;
}>) {
  const direction =
    sort === ascending ? 'ascending' : sort === descending ? 'descending' : undefined;
  const nextSort = sort === ascending ? descending : ascending;
  return (
    <th className={className} aria-sort={direction}>
      <button
        className="customer-sort-button"
        type="button"
        onClick={() => onSort(nextSort)}
        aria-label={`Sort by ${label}, ${nextSort === ascending ? 'ascending' : 'descending'}`}
      >
        <span>{label}</span>
        {direction ? (
          <span className="customer-sort-arrow" aria-hidden="true">
            {direction === 'ascending' ? '↑' : '↓'}
          </span>
        ) : null}
      </button>
    </th>
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
  const customerName = customer.name === customer.email ? null : customer.name;
  const customerHref = `/admin/customers/${encodeURIComponent(customer.id)}`;
  return (
    <tr>
      <td className="select">
        <input
          aria-label={`Select ${customerName ?? customer.email}`}
          type="checkbox"
          checked={checked}
          onChange={onToggle}
        />
      </td>
      <td className="customer-identity-cell customer-name-column" data-label="Customer name">
        {customerName ? (
          <Link href={customerHref}>{customerName}</Link>
        ) : (
          <span className="customer-name-missing">—</span>
        )}
      </td>
      <td className="customer-email-cell customer-email-column" data-label="Email">
        <Link href={customerHref}>{customer.email}</Link>
      </td>
      {columns.includes('subscription') ? (
        <td className="customer-subscription-column" data-label="Email subscription">
          <span
            className={`customer-subscription ${customer.emailMarketingStatus === 'SUBSCRIBED' ? 'subscribed' : ''}`}
          >
            {statusLabel(customer.emailMarketingStatus)}
          </span>
        </td>
      ) : null}
      {columns.includes('location') ? (
        <td className="customer-location-column" data-label="Location">
          {customer.location || '—'}
        </td>
      ) : null}
      {columns.includes('orders') ? (
        <td className="customer-orders-column" data-label="Orders">
          {customer.orderCount}
        </td>
      ) : null}
      {columns.includes('spent') ? (
        <td className="customer-spent-column" data-label="Amount spent">
          <strong>{money.format(customer.totalSpentCents / 100)}</strong>
        </td>
      ) : null}
      {columns.includes('lastOrder') ? (
        <td className="customer-last-order-column" data-label="Last order">
          {customer.lastOrderAt ? date.format(new Date(customer.lastOrderAt)) : '—'}
        </td>
      ) : null}
      {columns.includes('tags') ? (
        <td className="customer-tags-column" data-label="Tags">
          <div className="customer-tags">
            {customer.tags.length
              ? customer.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)
              : '—'}
          </div>
        </td>
      ) : null}
      {columns.includes('dateAdded') ? (
        <td className="customer-date-added-column" data-label="Date customer added">
          {formatCustomerTimestamp(customer.createdAt)}
        </td>
      ) : null}
      {columns.includes('dateUpdated') ? (
        <td className="customer-date-updated-column" data-label="Date customer updated">
          {formatCustomerTimestamp(customer.updatedAt)}
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

function formatCustomerTimestamp(value: string) {
  const timestamp = new Date(value);
  return `${date.format(timestamp)} - ${time.format(timestamp)}`;
}
