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

function ordersHref(
  values: Readonly<{
    view?: string | undefined;
    q?: string | undefined;
    page?: number | undefined;
    customerId?: string | undefined;
  }>,
) {
  const search = new URLSearchParams();
  if (values.view && values.view !== 'ALL') search.set('view', values.view);
  if (values.q) search.set('q', values.q);
  if (values.page && values.page > 1) search.set('page', String(values.page));
  if (values.customerId) search.set('customerId', values.customerId);
  const query = search.toString();
  return query ? `/admin/orders?${query}` : '/admin/orders';
}

export default async function AdminOrdersPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ view?: string; q?: string; page?: string; customerId?: string }>;
}>) {
  const search = await searchParams;
  const view = views.some(([id]) => id === search.view) ? search.view! : 'ALL';
  const session = await requireAdminSession();
  const result = await adminCommerceRuntime().listOrders(session, {
    view,
    ...(search.q ? { query: search.q } : {}),
    ...(search.customerId ? { customerId: search.customerId } : {}),
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
              href={ordersHref({ view: id, customerId: search.customerId })}
              aria-current={view === id ? 'page' : undefined}
            >
              {text}
            </Link>
          ))}
        </nav>
        <form className="commerce-admin-search" action="/admin/orders">
          {view !== 'ALL' ? <input type="hidden" name="view" value={view} /> : null}
          {search.customerId ? (
            <input type="hidden" name="customerId" value={search.customerId} />
          ) : null}
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
              <Link
                href={ordersHref({
                  view,
                  q: search.q,
                  customerId: search.customerId,
                  page: result.page - 1,
                })}
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span>
              Page {result.page} of {Math.ceil(result.total / result.limit)}
            </span>
            {result.page < Math.ceil(result.total / result.limit) ? (
              <Link
                href={ordersHref({
                  view,
                  q: search.q,
                  customerId: search.customerId,
                  page: result.page + 1,
                })}
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </main>
  );
}
