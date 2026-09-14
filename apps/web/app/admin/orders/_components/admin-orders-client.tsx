'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AdminFeedback, type AdminFeedbackTone } from '../../_components/admin-feedback';
import { canManageOrders, useAdminRole } from '../../admin-role';
import { readAdminPreferences, writeAdminPreferences } from '../../../../lib/admin-preferences';
import {
  clearOrderSelection,
  countOrderSelection,
  isOrderSelected,
  selectAllMatchingOrders,
  toggleOrder,
  toggleOrderPage,
} from './order-selection';
import { parseOrderListUrlState, writeOrderListUrlState } from './order-list-url-state';
import {
  adminFulfillmentStatuses,
  adminPaymentStatuses,
  adminPrintingStatuses,
  type AdminOrderListResponse,
  type AdminOrderSort,
  type AdminOrderView,
  type OrderExportSummary,
} from './order-types';
import { activeOrderExportSelection } from './order-export-selection';

const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const moneyFormatters = new Map<string, Intl.NumberFormat>();
const views: Array<[AdminOrderView, string]> = [
  ['ALL', 'All'],
  ['OPEN', 'Open'],
  ['IN_PROGRESS', 'In progress'],
  ['COMPLETED', 'Completed'],
  ['ATTENTION', 'Needs attention'],
  ['CANCELLED', 'Cancelled'],
];
const sortOptions: Array<[AdminOrderSort, string]> = [
  ['DATE_DESC', 'Newest first'],
  ['DATE_ASC', 'Oldest first'],
  ['ORDER_NUMBER_DESC', 'Order: high to low'],
  ['ORDER_NUMBER_ASC', 'Order: low to high'],
  ['CUSTOMER_ASC', 'Customer A–Z'],
  ['CUSTOMER_DESC', 'Customer Z–A'],
  ['ITEMS_ASC', 'Items: low to high'],
  ['ITEMS_DESC', 'Items: high to low'],
  ['PAYMENT_ASC', 'Payment A–Z'],
  ['PAYMENT_DESC', 'Payment Z–A'],
  ['FULFILLMENT_ASC', 'Fulfillment A–Z'],
  ['FULFILLMENT_DESC', 'Fulfillment Z–A'],
  ['TOTAL_ASC', 'Total: low to high'],
  ['TOTAL_DESC', 'Total: high to low'],
];

export function AdminOrdersClient() {
  const canManage = canManageOrders(useAdminRole());
  const [state, setState] = useState(() => {
    if (typeof window === 'undefined') return parseOrderListUrlState(new URLSearchParams());
    const search = new URLSearchParams(window.location.search);
    const parsed = parseOrderListUrlState(search);
    const saved = readAdminPreferences(window.localStorage);
    return {
      ...parsed,
      view: search.has('view') ? parsed.view : saved.orderView,
      sort: search.has('sort') ? parsed.sort : saved.orderSort,
    };
  });
  const [queryInput, setQueryInput] = useState(state.query);
  const [result, setResult] = useState<AdminOrderListResponse>();
  const [selection, setSelection] = useState(clearOrderSelection);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<{ message: string; tone: AdminFeedbackTone }>();
  const [busy, setBusy] = useState(false);
  const [exportJobs, setExportJobs] = useState<OrderExportSummary[]>([]);
  const exportInFlight = useRef(false);
  const firstReset = useRef(true);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setState((current) => ({ ...current, query: queryInput.trim(), page: 1 })),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    const search = writeOrderListUrlState(state).toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}`,
    );
  }, [state]);

  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    setSelection(clearOrderSelection());
    setFeedback(undefined);
  }, [
    state.query,
    state.view,
    state.sort,
    state.paymentStatus,
    state.printingStatus,
    state.fulfillmentStatus,
    state.dateFrom,
    state.dateTo,
    state.minTotal,
    state.maxTotal,
  ]);
  useEffect(() => {
    const saved = readAdminPreferences(window.localStorage);
    writeAdminPreferences(window.localStorage, {
      ...saved,
      orderView: state.view,
      orderSort: state.sort,
    });
  }, [state.view, state.sort]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const params = writeOrderListUrlState(state);
      params.set('limit', '30');
      setLoading(true);
      setError(undefined);
      try {
        const response = await fetch(
          `/api/admin/orders?${params}`,
          signal ? { signal } : undefined,
        );
        const payload = (await response.json()) as AdminOrderListResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Could not load orders.');
        setResult(payload);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Could not load orders.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [state],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const loadExports = useCallback(async () => {
    if (!canManage) return;
    try {
      const response = await fetch('/api/admin/order-exports');
      const payload = (await response.json()) as { exports?: OrderExportSummary[] };
      if (response.ok) setExportJobs(payload.exports ?? []);
    } catch {
      /* Directory remains usable. */
    }
  }, [canManage]);
  useEffect(() => {
    void loadExports();
  }, [loadExports]);
  useEffect(() => {
    if (!exportJobs.some((job) => job.status === 'QUEUED' || job.status === 'PROCESSING')) return;
    const timer = window.setInterval(() => void loadExports(), 3000);
    return () => window.clearInterval(timer);
  }, [exportJobs, loadExports]);

  async function exportOrders(orderIds?: string[]) {
    if (exportInFlight.current) return;
    const exportSelection = orderIds
      ? { type: 'IDS' as const, orderIds }
      : activeOrderExportSelection(selection, state);
    const requestedCount = orderIds?.length ?? selectedCount;
    if (!requestedCount) return;
    exportInFlight.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await fetch('/api/admin/orders/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selection: exportSelection }),
      });
      if (response.status === 202) {
        const payload = (await response.json()) as { export?: OrderExportSummary; error?: string };
        if (!payload.export) throw new Error(payload.error ?? 'Could not queue order export.');
        setExportJobs((current) => [
          payload.export!,
          ...current.filter((job) => job.id !== payload.export!.id),
        ]);
        setFeedback({
          message: `Export started for ${payload.export.totalCount.toLocaleString('en-US')} orders. You can safely leave this page.`,
          tone: 'info',
        });
        return;
      }
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? 'Could not export orders.');
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(href);
      setFeedback({
        message: `${requestedCount.toLocaleString('en-US')} orders exported.`,
        tone: 'success',
      });
    } catch (reason) {
      setFeedback({
        message: reason instanceof Error ? reason.message : 'Could not export orders.',
        tone: 'error',
      });
    } finally {
      exportInFlight.current = false;
      setBusy(false);
    }
  }

  const visibleIds = result?.orders.map((order) => order.id) ?? [];
  const allOnPageSelected =
    visibleIds.length > 0 && visibleIds.every((id) => isOrderSelected(selection, id));
  const selectedCount = countOrderSelection(selection, result?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / (result?.limit ?? 30)));
  const patchState = (patch: Partial<typeof state>, resetPage = true) =>
    setState((current) => ({ ...current, ...patch, ...(resetPage ? { page: 1 } : {}) }));

  return (
    <main className="commerce-admin-page commerce-admin-orders">
      <header className="commerce-admin-page-heading">
        <div>
          <p>Sales</p>
          <h1>Orders</h1>
          <span>{result?.total ?? '—'} orders in this view</span>
        </div>
        {canManage ? (
          <button
            className="customer-button secondary"
            type="button"
            disabled={!visibleIds.length || busy}
            onClick={() => void exportOrders(visibleIds)}
          >
            Export page
          </button>
        ) : null}
      </header>
      <section className="commerce-admin-card commerce-admin-directory">
        <nav className="commerce-admin-tabs" aria-label="Order views">
          {views.map(([id, text]) => (
            <button
              key={id}
              type="button"
              aria-current={state.view === id ? 'page' : undefined}
              onClick={() => patchState({ view: id })}
            >
              {text}
            </button>
          ))}
        </nav>
        <div className="order-admin-toolbar">
          <label className="order-admin-search">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">Search orders</span>
            <input
              type="search"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Search orders, customers, email or product"
            />
          </label>
          <details className="customer-popover">
            <summary>Filters</summary>
            <div className="customer-popover-panel filter-panel order-filter-panel">
              <FilterSelect
                label="Payment"
                value={state.paymentStatus}
                values={adminPaymentStatuses}
                onChange={(value) =>
                  patchState({ paymentStatus: value as typeof state.paymentStatus })
                }
              />
              <FilterSelect
                label="Printing"
                value={state.printingStatus}
                values={adminPrintingStatuses}
                onChange={(value) =>
                  patchState({ printingStatus: value as typeof state.printingStatus })
                }
              />
              <FilterSelect
                label="Fulfillment"
                value={state.fulfillmentStatus}
                values={adminFulfillmentStatuses}
                onChange={(value) =>
                  patchState({ fulfillmentStatus: value as typeof state.fulfillmentStatus })
                }
              />
              <label>
                From
                <input
                  type="date"
                  value={state.dateFrom}
                  onChange={(e) => patchState({ dateFrom: e.target.value })}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={state.dateTo}
                  onChange={(e) => patchState({ dateTo: e.target.value })}
                />
              </label>
              <label>
                Minimum total
                <input
                  inputMode="decimal"
                  value={state.minTotal}
                  onChange={(e) => patchState({ minTotal: e.target.value })}
                  placeholder="$0.00"
                />
              </label>
              <label>
                Maximum total
                <input
                  inputMode="decimal"
                  value={state.maxTotal}
                  onChange={(e) => patchState({ maxTotal: e.target.value })}
                  placeholder="$0.00"
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  patchState({
                    paymentStatus: '',
                    printingStatus: '',
                    fulfillmentStatus: '',
                    dateFrom: '',
                    dateTo: '',
                    minTotal: '',
                    maxTotal: '',
                  })
                }
              >
                Clear filters
              </button>
            </div>
          </details>
          <label className="customer-select-control">
            <span className="sr-only">Sort orders</span>
            <select
              value={state.sort}
              onChange={(e) => patchState({ sort: e.target.value as AdminOrderSort })}
            >
              {sortOptions.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          {canManage ? (
            <details className="customer-popover customer-exports-popover">
              <summary>
                Exports
                {exportJobs.some((job) => job.status === 'READY') ? (
                  <span aria-hidden="true" />
                ) : null}
              </summary>
              <OrderExportJobs jobs={exportJobs} />
            </details>
          ) : null}
        </div>
        {canManage && selectedCount ? (
          <div className="customer-bulk-bar" role="region" aria-label="Bulk order actions">
            <strong>{selectedCount.toLocaleString('en-US')} selected</strong>
            {allOnPageSelected &&
            !selection.allMatchingSelected &&
            selectedCount < (result?.total ?? 0) ? (
              <button
                className="select-all"
                type="button"
                onClick={() => setSelection(selectAllMatchingOrders())}
              >
                Select all ({result?.total.toLocaleString('en-US')})
              </button>
            ) : null}
            {selection.allMatchingSelected && selectedCount === result?.total ? (
              <span className="all-selected">All orders in this view are selected</span>
            ) : null}
            <button type="button" disabled={busy} onClick={() => void exportOrders()}>
              Export selected
            </button>
            <button
              className="quiet"
              type="button"
              disabled={busy}
              onClick={() => setSelection(clearOrderSelection())}
            >
              Clear
            </button>
          </div>
        ) : null}
        {feedback ? (
          <AdminFeedback tone={feedback.tone} onDismiss={() => setFeedback(undefined)}>
            {feedback.message}
          </AdminFeedback>
        ) : null}
        {error ? (
          <AdminFeedback tone="error" onDismiss={() => setError(undefined)}>
            {error}{' '}
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </AdminFeedback>
        ) : null}
        <div className="commerce-admin-table-scroll" aria-busy={loading}>
          <table>
            <thead>
              <tr>
                <th className="select">
                  <input
                    aria-label="Select all orders on this page"
                    type="checkbox"
                    disabled={!canManage || !visibleIds.length}
                    checked={allOnPageSelected}
                    onChange={() => setSelection(toggleOrderPage(selection, visibleIds))}
                  />
                </th>
                <Sortable
                  label="Order"
                  asc="ORDER_NUMBER_ASC"
                  desc="ORDER_NUMBER_DESC"
                  sort={state.sort}
                  onSort={(sort) => patchState({ sort })}
                />
                <Sortable
                  label="Date"
                  asc="DATE_ASC"
                  desc="DATE_DESC"
                  sort={state.sort}
                  onSort={(sort) => patchState({ sort })}
                />
                <Sortable
                  label="Customer"
                  asc="CUSTOMER_ASC"
                  desc="CUSTOMER_DESC"
                  sort={state.sort}
                  onSort={(sort) => patchState({ sort })}
                />
                <Sortable
                  label="Items"
                  asc="ITEMS_ASC"
                  desc="ITEMS_DESC"
                  sort={state.sort}
                  onSort={(sort) => patchState({ sort })}
                />
                <Sortable
                  label="Payment"
                  asc="PAYMENT_ASC"
                  desc="PAYMENT_DESC"
                  sort={state.sort}
                  onSort={(sort) => patchState({ sort })}
                />
                <Sortable
                  label="Fulfillment"
                  asc="FULFILLMENT_ASC"
                  desc="FULFILLMENT_DESC"
                  sort={state.sort}
                  onSort={(sort) => patchState({ sort })}
                />
                <Sortable
                  label="Total"
                  asc="TOTAL_ASC"
                  desc="TOTAL_DESC"
                  sort={state.sort}
                  onSort={(sort) => patchState({ sort })}
                />
              </tr>
            </thead>
            <tbody>
              {result?.orders.map((order) => (
                <tr key={order.id}>
                  <td className="select">
                    <input
                      aria-label={`Select ${order.orderNumber}`}
                      type="checkbox"
                      disabled={!canManage}
                      checked={isOrderSelected(selection, order.id)}
                      onChange={() => setSelection(toggleOrder(selection, order.id))}
                    />
                  </td>
                  <td>
                    <Link href={`/admin/orders/${encodeURIComponent(order.orderNumber)}`}>
                      {order.orderNumber}
                    </Link>
                    <small>{order.productName}</small>
                  </td>
                  <td>{date.format(new Date(order.createdAt))}</td>
                  <td>
                    {order.customerName}
                    <small>{order.customerEmail}</small>
                  </td>
                  <td>{order.itemCount}</td>
                  <td>
                    <span
                      className={`commerce-status ${order.paymentStatus === 'SUCCEEDED' ? 'is-paid' : ''}`}
                    >
                      {displayLabel(order.paymentStatus)}
                    </span>
                  </td>
                  <td>
                    <span className="commerce-status">{displayLabel(order.fulfillmentStatus)}</span>
                  </td>
                  <td>
                    <strong>{formatMoney(order.totalCents, order.currency)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? <div className="customer-table-state">Loading orders…</div> : null}
        </div>
        {!loading && !error && !result?.orders.length ? (
          <p className="commerce-admin-empty">No orders match this view.</p>
        ) : null}
        <footer className="customer-pagination">
          <span>
            {result
              ? `Showing ${result.total ? (state.page - 1) * result.limit + 1 : 0}–${Math.min(state.page * result.limit, result.total)} of ${result.total}`
              : 'Loading…'}
          </span>
          <div>
            <button
              type="button"
              aria-label="Previous page"
              disabled={state.page <= 1 || loading}
              onClick={() => patchState({ page: state.page - 1 }, false)}
            >
              ←
            </button>
            <span>
              Page {state.page} of {totalPages}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={state.page >= totalPages || loading}
              onClick={() => patchState({ page: state.page + 1 }, false)}
            >
              →
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}

function displayLabel(value: string) {
  if (value === 'SUCCEEDED') return 'Paid';
  const words = value.toLowerCase().replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function formatMoney(cents: number, currency: string) {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(cents / 100);
}

function FilterSelect({
  label: text,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {text}
      <select aria-label={text} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {values.map((item) => (
          <option key={item} value={item}>
            {displayLabel(item)}
          </option>
        ))}
      </select>
    </label>
  );
}
function Sortable({
  label: text,
  asc,
  desc,
  sort,
  onSort,
}: {
  label: string;
  asc: AdminOrderSort;
  desc: AdminOrderSort;
  sort: AdminOrderSort;
  onSort: (sort: AdminOrderSort) => void;
}) {
  const direction = sort === asc ? 'ascending' : sort === desc ? 'descending' : undefined;
  const next = sort === asc ? desc : asc;
  return (
    <th aria-sort={direction}>
      <button
        className="order-sort-button"
        type="button"
        aria-label={`Sort by ${text}, ${next === asc ? 'ascending' : 'descending'}`}
        onClick={() => onSort(next)}
      >
        <span>{text}</span>
        {direction ? <span aria-hidden="true">{direction === 'ascending' ? '↑' : '↓'}</span> : null}
      </button>
    </th>
  );
}

function OrderExportJobs({ jobs }: { jobs: OrderExportSummary[] }) {
  return (
    <div className="customer-popover-panel customer-export-panel">
      {jobs.length ? (
        jobs.map((job) => (
          <div className="customer-export-job" key={job.id}>
            <div>
              <strong>{job.fileName}</strong>
              <span>
                {exportLabel(job.status)} · {job.processedCount.toLocaleString('en-US')}/
                {job.totalCount.toLocaleString('en-US')}
              </span>
              {job.failureReason ? <small>{job.failureReason}</small> : null}
            </div>
            {job.status === 'READY' ? (
              <a href={`/api/admin/order-exports/${encodeURIComponent(job.id)}/download`}>
                Download
              </a>
            ) : null}
          </div>
        ))
      ) : (
        <p>No order exports yet.</p>
      )}
    </div>
  );
}
function exportLabel(status: OrderExportSummary['status']) {
  return status === 'QUEUED'
    ? 'Queued'
    : status === 'PROCESSING'
      ? 'Processing'
      : status === 'READY'
        ? 'Ready'
        : status === 'FAILED'
          ? 'Failed'
          : 'Expired';
}
