import Link from 'next/link';

import { adminCommerceRuntime, requireAdminSession } from '../../../lib/platform';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const views = [
  ['ALL', 'All'],
  ['OPEN', 'Open'],
  ['IN_PROGRESS', 'In progress'],
  ['COMPLETED', 'Completed'],
  ['ATTENTION', 'Needs attention'],
  ['CANCELLED', 'Cancelled'],
] as const;

function label(value: string) {
  return value.toLowerCase().replaceAll('_', ' ');
}

export default async function AdminOrdersPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ view?: string; q?: string; page?: string }> }>) {
  const search = await searchParams;
  const view = views.some(([id]) => id === search.view) ? search.view! : 'ALL';
  const session = await requireAdminSession();
  const result = await adminCommerceRuntime().listOrders(session, {
    view,
    ...(search.q ? { query: search.q } : {}),
    page: Number(search.page ?? 1),
    limit: 30,
  });
  return (
    <main className="commerce-admin-page commerce-admin-orders">
      <header className="commerce-admin-page-heading">
        <div>
          <p>Sales</p>
          <h1>Orders</h1>
          <span>
            {result.total} order{result.total === 1 ? '' : 's'} in this view
          </span>
        </div>
      </header>
      <section className="commerce-admin-card commerce-admin-directory">
        <nav className="commerce-admin-tabs" aria-label="Order views">
          {views.map(([id, text]) => (
            <Link
              key={id}
              href={id === 'ALL' ? '/admin/orders' : `/admin/orders?view=${id}`}
              aria-current={view === id ? 'page' : undefined}
            >
              {text}
            </Link>
          ))}
        </nav>
        <form className="commerce-admin-search" action="/admin/orders">
          {view !== 'ALL' ? <input type="hidden" name="view" value={view} /> : null}
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              name="q"
              defaultValue={search.q}
              placeholder="Search orders, customers or email"
            />
          </label>
          <button type="submit">Search</button>
        </form>
        <div className="commerce-admin-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Payment</th>
                <th>Fulfillment</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {result.orders.map((order) => (
                <tr key={order.orderNumber}>
                  <td>
                    <Link href={`/admin/orders/${encodeURIComponent(order.orderNumber)}`}>
                      {order.orderNumber}
                    </Link>
                    <small>{order.productName}</small>
                  </td>
                  <td>{date.format(order.createdAt)}</td>
                  <td>
                    {order.customerName}
                    <small>{order.customerEmail}</small>
                  </td>
                  <td>{order.itemCount}</td>
                  <td>
                    <span
                      className={`commerce-status ${order.paymentStatus === 'SUCCEEDED' ? 'is-paid' : ''}`}
                    >
                      {label(order.paymentStatus)}
                    </span>
                  </td>
                  <td>
                    <span className="commerce-status">{label(order.status)}</span>
                  </td>
                  <td>
                    <strong>{money.format(order.totalCents / 100)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!result.orders.length ? (
          <p className="commerce-admin-empty">No orders match this view.</p>
        ) : null}
        {result.total > result.limit ? (
          <nav className="commerce-admin-pagination" aria-label="Order pages">
            {result.page > 1 ? (
              <Link href={`/admin/orders?view=${view}&page=${result.page - 1}`}>Previous</Link>
            ) : (
              <span />
            )}
            <span>
              Page {result.page} of {Math.ceil(result.total / result.limit)}
            </span>
            {result.page < Math.ceil(result.total / result.limit) ? (
              <Link href={`/admin/orders?view=${view}&page=${result.page + 1}`}>Next</Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </main>
  );
}
