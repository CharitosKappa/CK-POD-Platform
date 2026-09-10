'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type Customer = {
  id: string;
  email: string;
  name: string;
  orderCount: number;
  totalSpentCents: number;
  creditBalance: number;
  lastOrderAt: string | null;
  tags: string[];
};
type CustomerResponse = { customers: Customer[]; total: number; page: number; limit: number };
type Sort = 'LAST_SEEN_DESC' | 'TOTAL_SPENT_DESC' | 'ORDER_COUNT_DESC' | 'NAME_ASC';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function OperationsCustomerList({
  apiBase = '/api/ops/customers',
  pageBase = '/ops/customers',
}: Readonly<{ apiBase?: string; pageBase?: string }>) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sort, setSort] = useState<Sort>('LAST_SEEN_DESC');
  const [minimumOrders, setMinimumOrders] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CustomerResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [showCredits, setShowCredits] = useState(true);
  const [showLastOrder, setShowLastOrder] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => setPage(1), [debouncedQuery, sort, minimumOrders]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: '30', sort });
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (minimumOrders) params.set('minOrders', '1');
    setLoading(true);
    setError(undefined);
    void fetch(`${apiBase}?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as CustomerResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Could not load customers.');
        setResult(payload);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Could not load customers.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [apiBase, debouncedQuery, minimumOrders, page, sort]);

  const summary = useMemo(() => {
    if (loading) return 'Loading customers…';
    if (!result) return 'Customers';
    return `${result.total.toLocaleString('en-US')} customer${result.total === 1 ? '' : 's'}`;
  }, [loading, result]);

  return (
    <main className="ops-admin-page ops-customers-page">
      <header className="ops-admin-page-header">
        <div>
          <p className="ops-admin-kicker">Customer base</p>
          <h1>Customers</h1>
          <p>{summary}</p>
        </div>
      </header>
      <section className="ops-customers-directory" aria-label="Customer directory">
        <div className="ops-customers-toolbar">
          <label className="ops-customers-search">
            <span className="sr-only">Search customers</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email, phone or address"
              type="search"
            />
          </label>
          <label className="ops-customers-filter">
            <input
              checked={minimumOrders}
              onChange={(event) => setMinimumOrders(event.target.checked)}
              type="checkbox"
            />
            <span>Has orders</span>
          </label>
          <label className="ops-customers-sort">
            <span className="sr-only">Sort customers</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="LAST_SEEN_DESC">Recently active</option>
              <option value="TOTAL_SPENT_DESC">Total spent</option>
              <option value="ORDER_COUNT_DESC">Order count</option>
              <option value="NAME_ASC">Name A–Z</option>
            </select>
          </label>
          <details className="ops-customers-columns">
            <summary>Columns</summary>
            <label>
              <input checked={showCredits} onChange={(event) => setShowCredits(event.target.checked)} type="checkbox" />
              Design credits
            </label>
            <label>
              <input checked={showLastOrder} onChange={(event) => setShowLastOrder(event.target.checked)} type="checkbox" />
              Last order
            </label>
          </details>
        </div>
        {error ? <p className="ops-admin-feedback is-error" role="alert">{error}</p> : null}
        <div className="ops-customer-table-wrap">
          <table className="ops-customer-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Orders</th>
                <th scope="col">Total spent</th>
                {showCredits ? <th scope="col">Design credits</th> : null}
                {showLastOrder ? <th scope="col">Last order</th> : null}
              </tr>
            </thead>
            <tbody>
              {result?.customers.map((customer) => (
                <tr key={customer.id}>
                  <td data-label="Customer">
                    <Link href={`${pageBase}/${encodeURIComponent(customer.id)}`}>{customer.name}</Link>
                    <span>{customer.email}</span>
                    {customer.tags.length ? <small>{customer.tags.join(' · ')}</small> : null}
                  </td>
                  <td data-label="Orders">{customer.orderCount}</td>
                  <td data-label="Total spent">{money.format(customer.totalSpentCents / 100)}</td>
                  {showCredits ? (
                    <td data-label="Design credits">
                      <span className={customer.creditBalance ? 'ops-customer-credit' : 'ops-status-chip neutral'}>
                        {customer.creditBalance ? `${customer.creditBalance} available` : 'No credits'}
                      </span>
                    </td>
                  ) : null}
                  {showLastOrder ? <td data-label="Last order">{customer.lastOrderAt ? date.format(new Date(customer.lastOrderAt)) : '—'}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !error && result?.customers.length === 0 ? <p className="ops-admin-empty">No customer matches this view.</p> : null}
        </div>
        {result && result.total > result.limit ? (
          <nav className="ops-customers-pagination" aria-label="Customer pages">
            <button type="button" className="ops-admin-secondary" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
            <span>Page {page} of {Math.ceil(result.total / result.limit)}</span>
            <button type="button" className="ops-admin-secondary" disabled={page >= Math.ceil(result.total / result.limit)} onClick={() => setPage((current) => current + 1)}>Next</button>
          </nav>
        ) : null}
      </section>
    </main>
  );
}
